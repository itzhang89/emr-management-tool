//! The `analyze_job_failure` tool.
//!
//! Ported from `mcp/src/tools/analyzeJobFailure.ts`. Flow:
//!
//!  0. Validate the job id. A malformed id is returned to the caller as a
//!     correction request — never searched for.
//!  1. Locate the job. With a `virtual_cluster_id` describe it directly (fast
//!     path within one account/cluster); otherwise search across the configured
//!     accounts, active account first, local history before AWS.
//!  2. If COMPLETED, short-circuit: the job ran normally — no log digging.
//!  3. Otherwise fetch the job's logs — S3 preferred, CloudWatch fallback —
//!     resolving the destination exactly like the desktop Logs page does.
//!     Controller (pod-level) logs are always collected alongside the Spark
//!     application logs: a pod that never started leaves nothing in the driver
//!     log, so its errors must not be buried behind the application logs.
//!  4. Filter noise, extract the error-relevant evidence, and — so the caller
//!     never comes away empty-handed — also return the sanitized raw logs for
//!     the calling model to judge.

use std::future::Future;

use serde::Serialize;

use crate::mcp::{analysis, job_id, log_destinations, noise, sanitize};
use crate::error::AppResult;

const RAW_LOG_TAIL_LINES: usize = 800;
const RAW_LOG_MAX_CHARS: usize = 200_000;
const CONTROLLER_TAIL_LINES: usize = 200;
const MAX_S3_OBJECTS_PER_TIER: usize = 5;
/// CloudWatch events fetched in the single call that serves both tiers.
const CLOUDWATCH_EVENT_LIMIT: i32 = 5000;

// --- Data source ----------------------------------------------------------
// The tool is written against this trait rather than the AWS SDK directly, so
// the report logic is testable without AWS (the TS version took a
// `BridgeClient` for the same reason). `source.rs` holds the real
// implementation over the app's existing commands.

/// The subset of a job the report needs.
#[derive(Debug, Clone, Default)]
pub struct JobRef {
    pub id: String,
    pub name: Option<String>,
    pub state: String,
    pub virtual_cluster_id: String,
    pub created_at: Option<String>,
    pub finished_at: Option<String>,
    pub started_at: Option<String>,
    pub failure_reason: Option<String>,
    pub state_details: Option<String>,
    pub release_label: Option<String>,
    /// Raw `configurationOverrides` JSON, used to resolve log destinations.
    pub configuration_overrides: Option<serde_json::Value>,
}

/// A job located by id, plus which account it was found in.
#[derive(Debug, Clone)]
pub struct FoundJob {
    pub job: JobRef,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub region: Option<String>,
    pub found_in_other_account: bool,
}

/// One S3 log object, already classified by the app's path rules.
#[derive(Debug, Clone)]
pub struct LogObject {
    pub s3_key: String,
    /// "controller" | "driver" | "executor", or "sparkLog" when unclassified.
    pub log_type: String,
}

impl LogObject {
    /// Controller (pod-level) objects. The classification is trusted first; the
    /// key is checked as a fallback for objects the classifier could not place.
    fn is_controller(&self) -> bool {
        self.log_type == "controller" || self.s3_key.contains("/control-logs/")
    }
}

/// One CloudWatch log event.
#[derive(Debug, Clone)]
pub struct LogEvent {
    pub message: String,
    pub stream_name: String,
}

pub trait JobDataSource {
    /// Locate a job across every configured account, active account first.
    fn find_job(&self, job_id: &str) -> impl Future<Output = AppResult<FoundJob>> + Send;

    /// Describe a job within a known cluster.
    fn describe_job(
        &self,
        account_id: Option<&str>,
        job_id: &str,
        virtual_cluster_id: &str,
    ) -> impl Future<Output = AppResult<JobRef>> + Send;

    fn list_s3_objects(
        &self,
        account_id: Option<&str>,
        bucket: &str,
        prefix: &str,
    ) -> impl Future<Output = AppResult<Vec<LogObject>>> + Send;

    fn get_s3_object(
        &self,
        account_id: Option<&str>,
        bucket: &str,
        key: &str,
    ) -> impl Future<Output = AppResult<String>> + Send;

    fn get_logs(
        &self,
        account_id: Option<&str>,
        job_id: &str,
        log_group_name: &str,
        stream_name_prefix: &str,
        limit: i32,
    ) -> impl Future<Output = AppResult<Vec<LogEvent>>> + Send;
}

// --- Tool arguments -------------------------------------------------------

#[derive(Debug, Clone, serde::Deserialize, schemars::JsonSchema, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeJobFailureArgs {
    /// Complete EMR job run ID — a lowercase alphanumeric id of 16-64 chars
    /// (e.g. "0000000381t77o3g8f5"), optionally "spark-" prefixed. Never
    /// truncate or invent it.
    pub job_id: String,
    /// EMR virtual cluster ID (optional — auto-resolved if omitted).
    #[serde(default)]
    pub virtual_cluster_id: Option<String>,
    /// Account ID (optional — defaults to active account, then other accounts).
    #[serde(default)]
    pub account_id: Option<String>,
    /// Log type to analyze: "driver" (default), "executor" or "controller".
    #[serde(default)]
    pub log_type: Option<String>,
    /// Stream name filter (default: "stderr").
    #[serde(default)]
    pub stream: Option<String>,
}

// --- Report shape ---------------------------------------------------------
// Serialized as the tool's JSON text output, key-for-key identical to the TS
// version so existing agent prompts keep working.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountScope {
    pub id: Option<String>,
    pub name: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobReport {
    pub id: String,
    pub name: Option<String>,
    pub state: Option<String>,
    pub failure_reason: String,
    pub state_details: String,
    pub virtual_cluster_id: String,
    pub created_at: Option<String>,
    pub finished_at: Option<String>,
    pub release_label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerEvidence {
    pub log_source: String,
    pub error_tail: Vec<String>,
    pub tracebacks: Vec<String>,
    pub deepest_caused_by: Option<String>,
    pub candidate_causes: Vec<analysis::CandidateCause>,
    pub raw_logs: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub log_source: String,
    pub error_tail: Vec<String>,
    pub tracebacks: Vec<String>,
    pub deepest_caused_by: Option<String>,
    pub step_ids: Vec<String>,
    pub candidate_causes: Vec<analysis::CandidateCause>,
    /// The actual (noise-filtered, sanitized) log text: the last
    /// RAW_LOG_TAIL_LINES lines. Always present so the caller can judge even
    /// when the heuristic fields above are empty.
    pub raw_logs: String,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMeta {
    pub total_log_lines: usize,
    pub noise_filtered_lines: usize,
    pub raw_log_tail_lines: usize,
    pub controller_log_lines: usize,
    pub analysis_generated: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureReport {
    pub found_in_other_account: bool,
    pub account: AccountScope,
    pub job: JobReport,
    pub summary: String,
    /// Pod-level evidence, reported ahead of the application logs: check this
    /// first — an image pull failure, OOMKill, or rejected service account
    /// never reaches the Spark driver log.
    pub controller_evidence: ControllerEvidence,
    pub evidence: Evidence,
    pub meta: ReportMeta,
}

/// A job that finished successfully: no logs are fetched, just a clean status.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionReport {
    pub ok: bool,
    pub found_in_other_account: bool,
    pub account: AccountScope,
    pub summary: String,
    pub job: CompletionJob,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionJob {
    pub id: String,
    pub name: Option<String>,
    pub state: Option<String>,
    pub virtual_cluster_id: String,
    pub released_label: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// A malformed job id is a caller mistake, not a lookup failure.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidJobIdReport {
    pub ok: bool,
    pub error: String,
    pub provided_job_id: String,
    pub summary: String,
    pub expected_format: String,
    pub next_step: String,
}

/// What the tool returns: one of three report shapes, serialized as JSON text.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum AnalyzeJobFailureReport {
    InvalidJobId(InvalidJobIdReport),
    Completed(CompletionReport),
    Failure(FailureReport),
}

impl AnalyzeJobFailureReport {
    pub fn to_json_text(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|e| {
            format!("{{\"error\":\"failed to serialize report: {e}\"}}")
        })
    }

    pub fn internal_failure(job_id: &str, message: &str) -> Self {
        AnalyzeJobFailureReport::Failure(FailureReport {
            found_in_other_account: false,
            account: AccountScope {
                id: None,
                name: None,
                region: None,
            },
            job: JobReport {
                id: job_id.to_string(),
                name: None,
                state: None,
                failure_reason: String::new(),
                state_details: String::new(),
                virtual_cluster_id: String::new(),
                created_at: None,
                finished_at: None,
                release_label: None,
            },
            summary: format!("internal error: {message}"),
            controller_evidence: ControllerEvidence {
                log_source: "none".to_string(),
                error_tail: Vec::new(),
                tracebacks: Vec::new(),
                deepest_caused_by: None,
                candidate_causes: Vec::new(),
                raw_logs: String::new(),
            },
            evidence: Evidence {
                log_source: "none".to_string(),
                error_tail: Vec::new(),
                tracebacks: Vec::new(),
                deepest_caused_by: None,
                step_ids: Vec::new(),
                candidate_causes: Vec::new(),
                raw_logs: String::new(),
                truncated: false,
            },
            meta: ReportMeta {
                total_log_lines: 0,
                noise_filtered_lines: 0,
                raw_log_tail_lines: 0,
                controller_log_lines: 0,
                analysis_generated: chrono::Utc::now().to_rfc3339(),
            },
        })
    }
}

// --- The tool ------------------------------------------------------------

pub async fn run<S: JobDataSource>(
    source: &S,
    args: &AnalyzeJobFailureArgs,
) -> AppResult<AnalyzeJobFailureReport> {
    // --- 0. Reject malformed ids up front --------------------------------
    // Searching every configured account for a truncated id wastes AWS calls
    // and reports a misleading "not found"; ask the caller to fix the input.
    if !job_id::is_likely_emr_job_run_id(&args.job_id) {
        return Ok(AnalyzeJobFailureReport::InvalidJobId(InvalidJobIdReport {
            ok: false,
            error: "invalidJobId".to_string(),
            provided_job_id: args.job_id.clone(),
            summary: job_id::describe_invalid_job_id(&args.job_id),
            expected_format: "A lowercase alphanumeric EMR on EKS job run id of 16-64 characters (e.g. \"0000000381t77o3g8f5\"), optionally prefixed with \"spark-\". Classic \"job-…\" ids are also accepted.".to_string(),
            next_step: "Ask the user for the complete job id and call analyze_job_failure again. Do not guess, truncate, or search for alternatives.".to_string(),
        }));
    }
    let job_id_value = job_id::normalize(&args.job_id);

    // --- 1. Locate the job ------------------------------------------------
    let mut account_id = args.account_id.clone();
    let mut account_name: Option<String> = None;
    let mut region: Option<String> = None;
    let mut found_in_other_account = false;

    let job = if let Some(virtual_cluster_id) = args.virtual_cluster_id.as_deref() {
        // Fast path: the caller pinned the cluster. Describe within that scope.
        source
            .describe_job(account_id.as_deref(), &job_id_value, virtual_cluster_id)
            .await?
    } else {
        // Cross-account search: local job history first, then AWS, active
        // account first — the same lookup order as the desktop Job History.
        let found = source.find_job(&job_id_value).await?;
        account_id = found.account_id;
        account_name = found.account_name;
        region = found.region;
        found_in_other_account = found.found_in_other_account;
        found.job
    };

    let virtual_cluster_id = args
        .virtual_cluster_id
        .clone()
        .unwrap_or_else(|| job.virtual_cluster_id.clone());

    let account = AccountScope {
        id: account_id.clone(),
        name: account_name.clone(),
        region: region.clone(),
    };

    // --- 2. Normal completion short-circuit -------------------------------
    let state = job.state.to_uppercase();
    if state == "COMPLETED" || state == "SUCCEEDED" {
        return Ok(AnalyzeJobFailureReport::Completed(CompletionReport {
            ok: true,
            found_in_other_account,
            account,
            summary: "Job completed successfully — no failure to analyze.".to_string(),
            job: CompletionJob {
                id: job.id.clone(),
                name: job.name.clone(),
                state: Some(job.state.clone()).filter(|s| !s.is_empty()),
                virtual_cluster_id,
                released_label: job.release_label.clone(),
                started_at: job.started_at.clone(),
                finished_at: job.finished_at.clone(),
            },
        }));
    }

    // --- 3. Gather log evidence (S3 first, then CloudWatch) ---------------
    let evidence = gather_log_evidence(
        source,
        account_id.as_deref(),
        &job_id_value,
        &virtual_cluster_id,
        &job,
        args.log_type.as_deref().unwrap_or("driver"),
        args.stream.as_deref().unwrap_or("stderr"),
    )
    .await;

    // --- 4. Extract the error-relevant lines ------------------------------
    // Controller (pod-level) evidence is analyzed first and reported
    // separately: a pod that never started leaves nothing in the driver log, so
    // its errors must not be buried behind the Spark application logs.
    let controller_filtered = noise::filter(&evidence.controller_log_text);
    let controller_analysis = analysis::extract_error_sections(&controller_filtered.text);

    let filtered = noise::filter(&evidence.log_text);
    let application_analysis = analysis::extract_error_sections(&filtered.text);

    let candidate_causes = sanitize_causes(application_analysis.candidate_causes);
    let controller_candidate_causes = sanitize_causes(controller_analysis.candidate_causes);

    // The caller must always be able to analyze the failure even when the
    // heuristic extractor finds nothing: hand back the (noise-filtered,
    // sanitized) raw logs themselves.
    let relevant_lines: Vec<&str> = filtered
        .text
        .split('\n')
        .filter(|line| !line.trim().is_empty() && !noise::is_generic_noise_info(line))
        .collect();
    let raw_log_tail = tail_lines(&relevant_lines, RAW_LOG_TAIL_LINES);
    let mut raw_logs = sanitize::sanitize(&raw_log_tail);
    if raw_logs.chars().count() > RAW_LOG_MAX_CHARS {
        let kept: String = raw_logs
            .chars()
            .skip(raw_logs.chars().count() - RAW_LOG_MAX_CHARS)
            .collect();
        raw_logs = format!("{kept}\n[truncated]");
    }

    let controller_relevant_lines: Vec<&str> = controller_filtered
        .text
        .split('\n')
        .filter(|line| !line.trim().is_empty() && !noise::is_generic_noise_info(line))
        .collect();
    let controller_raw_logs = sanitize::sanitize(&tail_lines(
        &controller_relevant_lines,
        CONTROLLER_TAIL_LINES,
    ));

    let has_controller_evidence = !controller_analysis.error_tail.is_empty()
        || !controller_analysis.tracebacks.is_empty()
        || !controller_candidate_causes.is_empty();
    let has_evidence = !application_analysis.error_tail.is_empty()
        || !application_analysis.tracebacks.is_empty()
        || has_controller_evidence;

    let failure_reason = job.failure_reason.clone().unwrap_or_default();
    let state_details = job.state_details.clone().unwrap_or_default();

    let summary = summarize_failure(
        &state,
        &failure_reason,
        &state_details,
        &candidate_causes,
        &controller_candidate_causes,
        &evidence.source,
        has_evidence,
    );

    Ok(AnalyzeJobFailureReport::Failure(FailureReport {
        found_in_other_account,
        account,
        job: JobReport {
            id: job.id.clone(),
            name: job.name.clone(),
            state: Some(job.state.clone()).filter(|s| !s.is_empty()),
            failure_reason: sanitize::sanitize(&failure_reason),
            state_details: sanitize::sanitize(&state_details),
            virtual_cluster_id,
            created_at: job.created_at.clone(),
            finished_at: job.finished_at.clone(),
            release_label: job.release_label.clone(),
        },
        summary,
        controller_evidence: ControllerEvidence {
            log_source: evidence.controller_source.clone(),
            error_tail: sanitize_lines(controller_analysis.error_tail),
            tracebacks: sanitize_lines(controller_analysis.tracebacks),
            deepest_caused_by: controller_analysis
                .deepest_caused_by
                .as_deref()
                .map(sanitize::sanitize),
            candidate_causes: controller_candidate_causes,
            raw_logs: controller_raw_logs,
        },
        evidence: Evidence {
            log_source: evidence.source.clone(),
            error_tail: sanitize_lines(application_analysis.error_tail),
            tracebacks: sanitize_lines(application_analysis.tracebacks),
            deepest_caused_by: application_analysis
                .deepest_caused_by
                .as_deref()
                .map(sanitize::sanitize),
            step_ids: application_analysis.step_ids,
            candidate_causes,
            truncated: relevant_lines.len() > RAW_LOG_TAIL_LINES
                || raw_logs.ends_with("[truncated]"),
            raw_logs,
        },
        meta: ReportMeta {
            total_log_lines: filtered.text.split('\n').count(),
            noise_filtered_lines: filtered.hidden_count,
            raw_log_tail_lines: relevant_lines.len().min(RAW_LOG_TAIL_LINES),
            controller_log_lines: controller_relevant_lines.len(),
            analysis_generated: chrono::Utc::now().to_rfc3339(),
        },
    }))
}

fn tail_lines(lines: &[&str], count: usize) -> String {
    let start = lines.len().saturating_sub(count);
    lines[start..].join("\n")
}

fn sanitize_lines(lines: Vec<String>) -> Vec<String> {
    lines.iter().map(|line| sanitize::sanitize(line)).collect()
}

fn sanitize_causes(causes: Vec<analysis::CandidateCause>) -> Vec<analysis::CandidateCause> {
    causes
        .into_iter()
        .map(|cause| analysis::CandidateCause {
            evidence: sanitize::sanitize(&cause.evidence),
            ..cause
        })
        .collect()
}

fn summarize_failure(
    state: &str,
    failure_reason: &str,
    state_details: &str,
    candidate_causes: &[analysis::CandidateCause],
    controller_candidate_causes: &[analysis::CandidateCause],
    source: &str,
    has_evidence: bool,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !failure_reason.is_empty() {
        parts.push(format!("EMR failure reason: {failure_reason}"));
    }
    if !state_details.is_empty() {
        parts.push(format!("State details: {state_details}"));
    }
    // Pod-level causes lead: they explain failures that never reach Spark.
    if !controller_candidate_causes.is_empty() {
        parts.push(format!(
            "Controller (pod-level) causes: {}",
            describe_causes(controller_candidate_causes)
        ));
    }
    if !candidate_causes.is_empty() {
        parts.push(format!(
            "Application (Spark) causes: {}",
            describe_causes(candidate_causes)
        ));
    }
    if source == "none" {
        parts.push(
            "No application log source was found (neither S3 nor CloudWatch).".to_string(),
        );
    } else if !has_evidence {
        parts.push("No structured error evidence was extracted automatically; analyze controllerEvidence.rawLogs and evidence.rawLogs directly.".to_string());
    }

    if parts.is_empty() {
        format!("Job is in state {state} with no additional detail available.")
    } else {
        parts.join("\n")
    }
}

fn describe_causes(causes: &[analysis::CandidateCause]) -> String {
    causes
        .iter()
        .map(|cause| format!("{} ({})", cause.cause, cause.confidence))
        .collect::<Vec<_>>()
        .join("; ")
}

// --- Log gathering -------------------------------------------------------

struct LogEvidence {
    log_text: String,
    /// "s3" | "cloudwatch" | "none"
    source: String,
    /// Pod-level (control-logs / controller container) text, gathered separately.
    controller_log_text: String,
    controller_source: String,
}

/// One tier's text plus where it came from.
struct SourcedText {
    text: String,
    source: String,
}

#[derive(Default)]
struct SplitEvidence {
    controller: Option<SourcedText>,
    application: Option<SourcedText>,
}

/// Fetch the job's logs, S3 preferred then CloudWatch. Destination resolution
/// mirrors the desktop Logs page (`log_destinations`):
///
///  - S3 → `configurationOverrides.monitoringConfiguration.s3MonitoringConfiguration.logUri`
///    → prefix `{logUri prefix}{virtualClusterId}/jobs/{jobId}/`
///  - CloudWatch → `cloudWatchMonitoringConfiguration` (logGroupName +
///    streamNamePrefix), falling back to the conventional
///    `/aws/emr-containers/jobs/{jobId}` group with the job id as the stream
///    prefix. As a last resort, S3-only jobs also probe the conventional group
///    in case the S3 archive is empty.
async fn gather_log_evidence<S: JobDataSource>(
    source: &S,
    account_id: Option<&str>,
    job_id_value: &str,
    virtual_cluster_id: &str,
    job: &JobRef,
    log_type: &str,
    stream: &str,
) -> LogEvidence {
    // Re-describe even when the account/cluster is known: local job-history rows
    // written by a StartJobRun submission carry no describe details — their
    // monitoring config only exists in AWS. Errors here are non-fatal; the
    // conventional CloudWatch fallback still applies.
    let described = if !virtual_cluster_id.is_empty() {
        source
            .describe_job(account_id, job_id_value, virtual_cluster_id)
            .await
            .ok()
    } else {
        source.find_job(job_id_value).await.ok().map(|found| found.job)
    };

    let configuration_overrides = described
        .as_ref()
        .and_then(|job| job.configuration_overrides.clone())
        .or_else(|| job.configuration_overrides.clone());

    // Mirror the Logs page: configured destinations win, otherwise fall back to
    // the conventional CloudWatch group naming.
    let resolved = log_destinations::resolve(
        job_id_value,
        virtual_cluster_id,
        configuration_overrides.as_ref(),
    );
    let has_configured_destination = resolved.cloud_watch.is_some() || resolved.s3.is_some();
    let destinations = if has_configured_destination {
        resolved
    } else {
        log_destinations::JobLogDestinations {
            cloud_watch: Some(log_destinations::default_cloud_watch_destination(
                job_id_value,
            )),
            s3: None,
        }
    };

    // S3 is listed once and CloudWatch fetched once; the results are split into
    // controller (pod-level) and application (driver/executor) text rather than
    // querying AWS twice for the same data.
    let mut split = SplitEvidence::default();

    if let Some(s3) = &destinations.s3 {
        split = fetch_s3_evidence(source, account_id, s3, stream, log_type).await;
    }

    // CloudWatch fills whichever tier S3 did not provide.
    if split.controller.is_none() || split.application.is_none() {
        let cloud_watch = destinations.cloud_watch.clone().or_else(|| {
            // S3-only jobs whose archive is empty/missing still often wrote to
            // the conventional group, so probe it as a last resort.
            destinations
                .s3
                .as_ref()
                .map(|_| log_destinations::default_cloud_watch_destination(job_id_value))
        });

        if let Some(cloud_watch) = cloud_watch {
            let from_cloud_watch = fetch_cloud_watch_evidence(
                source,
                account_id,
                job_id_value,
                &cloud_watch,
                log_type,
                stream,
            )
            .await;
            if split.controller.is_none() {
                split.controller = from_cloud_watch.controller;
            }
            if split.application.is_none() {
                split.application = from_cloud_watch.application;
            }
        }
    }

    LogEvidence {
        log_text: split
            .application
            .as_ref()
            .map(|t| t.text.clone())
            .unwrap_or_default(),
        source: split
            .application
            .as_ref()
            .map(|t| t.source.clone())
            .unwrap_or_else(|| "none".to_string()),
        controller_log_text: split
            .controller
            .as_ref()
            .map(|t| t.text.clone())
            .unwrap_or_default(),
        controller_source: split
            .controller
            .as_ref()
            .map(|t| t.source.clone())
            .unwrap_or_else(|| "none".to_string()),
    }
}

/// List the job's S3 log objects once, then read the controller and application
/// tiers separately.
async fn fetch_s3_evidence<S: JobDataSource>(
    source: &S,
    account_id: Option<&str>,
    s3: &log_destinations::S3Destination,
    desired_stream: &str,
    application_type: &str,
) -> SplitEvidence {
    let Ok(objects) = source
        .list_s3_objects(account_id, &s3.bucket, &s3.prefix)
        .await
    else {
        // Fall through to CloudWatch.
        return SplitEvidence::default();
    };

    let controller_objects: Vec<&LogObject> =
        objects.iter().filter(|o| o.is_controller()).collect();
    let application_objects: Vec<&LogObject> = if application_type.eq_ignore_ascii_case("controller")
    {
        controller_objects.clone()
    } else {
        objects.iter().filter(|o| !o.is_controller()).collect()
    };

    // Controller logs are small and there is only ever one stream worth reading,
    // so no stream filter is applied there.
    let controller_text =
        read_s3_objects(source, account_id, &s3.bucket, &controller_objects, None).await;
    let application_text = read_s3_objects(
        source,
        account_id,
        &s3.bucket,
        &application_objects,
        Some(desired_stream),
    )
    .await;

    SplitEvidence {
        controller: (!controller_text.is_empty()).then(|| SourcedText {
            text: controller_text,
            source: "s3".to_string(),
        }),
        application: (!application_text.is_empty()).then(|| SourcedText {
            text: application_text,
            source: "s3".to_string(),
        }),
    }
}

async fn read_s3_objects<S: JobDataSource>(
    source: &S,
    account_id: Option<&str>,
    bucket: &str,
    objects: &[&LogObject],
    desired_stream: Option<&str>,
) -> String {
    let mut candidates: Vec<&&LogObject> = objects.iter().collect();
    if let Some(stream) = desired_stream {
        let lowered = stream.to_lowercase();
        let matching: Vec<&&LogObject> = candidates
            .iter()
            .copied()
            .filter(|o| o.s3_key.to_lowercase().contains(&lowered))
            .collect();
        if !matching.is_empty() {
            candidates = matching;
        }
    }

    let mut messages: Vec<String> = Vec::new();
    for object in candidates.into_iter().take(MAX_S3_OBJECTS_PER_TIER) {
        // An unreadable object is skipped rather than failing the whole tier.
        if let Ok(content) = source
            .get_s3_object(account_id, bucket, &object.s3_key)
            .await
        {
            messages.extend(
                content
                    .split('\n')
                    .filter(|line| !line.is_empty())
                    .map(ToString::to_string),
            );
        }
    }
    messages.join("\n")
}

/// Fetch the job's CloudWatch entries once, then split them by stream name:
/// driver / executor streams are the application tier, everything else (the
/// control pod) is the controller tier.
async fn fetch_cloud_watch_evidence<S: JobDataSource>(
    source: &S,
    account_id: Option<&str>,
    job_id_value: &str,
    destination: &log_destinations::CloudWatchDestination,
    log_type: &str,
    stream: &str,
) -> SplitEvidence {
    let Ok(events) = source
        .get_logs(
            account_id,
            job_id_value,
            &destination.log_group_name,
            destination.stream_name_prefix.as_deref().unwrap_or(""),
            CLOUDWATCH_EVENT_LIMIT,
        )
        .await
    else {
        return SplitEvidence::default();
    };

    let is_driver = |name: &str| name.to_lowercase().contains("driver");
    let is_executor = |name: &str| name.to_lowercase().contains("exec");

    let controller_events: Vec<&LogEvent> = events
        .iter()
        .filter(|e| !is_driver(&e.stream_name) && !is_executor(&e.stream_name))
        .collect();

    let want = log_type.to_lowercase();
    let mut application_events: Vec<&LogEvent> = match want.as_str() {
        "driver" => events.iter().filter(|e| is_driver(&e.stream_name)).collect(),
        "executor" => events
            .iter()
            .filter(|e| is_executor(&e.stream_name))
            .collect(),
        "controller" => controller_events.clone(),
        _ => events.iter().collect(),
    };

    if !stream.is_empty() {
        let lowered = stream.to_lowercase();
        let stream_filtered: Vec<&LogEvent> = application_events
            .iter()
            .copied()
            .filter(|e| e.stream_name.to_lowercase().contains(&lowered))
            .collect();
        if !stream_filtered.is_empty() {
            application_events = stream_filtered;
        }
    }

    let join = |events: &[&LogEvent]| {
        events
            .iter()
            .map(|e| e.message.clone())
            .collect::<Vec<_>>()
            .join("\n")
    };

    SplitEvidence {
        controller: (!controller_events.is_empty()).then(|| SourcedText {
            text: join(&controller_events),
            source: "cloudwatch".to_string(),
        }),
        application: (!application_events.is_empty()).then(|| SourcedText {
            text: join(&application_events),
            source: "cloudwatch".to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use std::sync::Mutex;

    /// Records what the tool asked for so the tests can assert on AWS access
    /// patterns (the TS suite did the same with a hand-rolled BridgeClient).
    #[derive(Default)]
    struct Calls {
        found_ids: Vec<String>,
        described: Vec<String>,
        listed_s3: Vec<(String, String)>,
        read_keys: Vec<String>,
        cloud_watch: Vec<(String, String)>,
    }

    /// A fake data source. Each closure-ish field is a canned response; `calls`
    /// captures the requests.
    struct Fake {
        calls: Mutex<Calls>,
        job: JobRef,
        account_id: Option<String>,
        account_name: Option<String>,
        region: Option<String>,
        found_in_other_account: bool,
        s3_objects: Vec<LogObject>,
        /// Key substring → content. First match wins.
        s3_contents: Vec<(String, String)>,
        cloud_watch_events: Vec<LogEvent>,
        /// When set, `get_logs` fails — used to assert S3 was preferred.
        cloud_watch_fails: bool,
        find_fails: bool,
    }

    impl Fake {
        fn new(job: JobRef) -> Self {
            Self {
                calls: Mutex::new(Calls::default()),
                job,
                account_id: Some("acct-1".to_string()),
                account_name: None,
                region: Some("us-east-1".to_string()),
                found_in_other_account: false,
                s3_objects: Vec::new(),
                s3_contents: Vec::new(),
                cloud_watch_events: Vec::new(),
                cloud_watch_fails: false,
                find_fails: false,
            }
        }

        fn calls(&self) -> std::sync::MutexGuard<'_, Calls> {
            self.calls.lock().expect("calls lock")
        }
    }

    fn failed_job(id: &str) -> JobRef {
        JobRef {
            id: id.to_string(),
            name: Some("my-job".to_string()),
            state: "FAILED".to_string(),
            virtual_cluster_id: "vc-1".to_string(),
            created_at: Some("2026-08-01T10:00:00.000Z".to_string()),
            ..Default::default()
        }
    }

    fn s3_only_overrides() -> serde_json::Value {
        serde_json::json!({
            "monitoringConfiguration": {
                "s3MonitoringConfiguration": {"logUri": "s3://my-log-bucket/path/"}
            }
        })
    }

    impl JobDataSource for Fake {
        async fn find_job(&self, job_id: &str) -> AppResult<FoundJob> {
            self.calls().found_ids.push(job_id.to_string());
            if self.find_fails {
                return Err(AppError::validation("must not search"));
            }
            Ok(FoundJob {
                job: JobRef {
                    id: job_id.to_string(),
                    ..self.job.clone()
                },
                account_id: self.account_id.clone(),
                account_name: self.account_name.clone(),
                region: self.region.clone(),
                found_in_other_account: self.found_in_other_account,
            })
        }

        async fn describe_job(
            &self,
            _account_id: Option<&str>,
            job_id: &str,
            _virtual_cluster_id: &str,
        ) -> AppResult<JobRef> {
            self.calls().described.push(job_id.to_string());
            Ok(JobRef {
                id: job_id.to_string(),
                ..self.job.clone()
            })
        }

        async fn list_s3_objects(
            &self,
            _account_id: Option<&str>,
            bucket: &str,
            prefix: &str,
        ) -> AppResult<Vec<LogObject>> {
            self.calls()
                .listed_s3
                .push((bucket.to_string(), prefix.to_string()));
            Ok(self.s3_objects.clone())
        }

        async fn get_s3_object(
            &self,
            _account_id: Option<&str>,
            _bucket: &str,
            key: &str,
        ) -> AppResult<String> {
            self.calls().read_keys.push(key.to_string());
            for (needle, content) in &self.s3_contents {
                if key.contains(needle.as_str()) {
                    return Ok(content.clone());
                }
            }
            Ok(String::new())
        }

        async fn get_logs(
            &self,
            _account_id: Option<&str>,
            _job_id: &str,
            log_group_name: &str,
            stream_name_prefix: &str,
            _limit: i32,
        ) -> AppResult<Vec<LogEvent>> {
            self.calls().cloud_watch.push((
                log_group_name.to_string(),
                stream_name_prefix.to_string(),
            ));
            if self.cloud_watch_fails {
                return Err(AppError::internal(
                    "should not reach CloudWatch when S3 has logs",
                ));
            }
            Ok(self.cloud_watch_events.clone())
        }
    }

    fn args(job_id: &str) -> AnalyzeJobFailureArgs {
        AnalyzeJobFailureArgs {
            job_id: job_id.to_string(),
            virtual_cluster_id: None,
            account_id: None,
            log_type: None,
            stream: None,
        }
    }

    /// Parse the report back out of its JSON so assertions read like the TS ones.
    fn parse(report: &AnalyzeJobFailureReport) -> serde_json::Value {
        serde_json::from_str(&report.to_json_text()).expect("report is valid JSON")
    }

    #[tokio::test]
    async fn locates_a_job_across_accounts_when_no_cluster_is_given() {
        let mut fake = Fake::new(failed_job("job-00000abc"));
        fake.account_id = Some("acct-2".to_string());
        fake.account_name = Some("My Second Account".to_string());
        fake.region = Some("us-west-2".to_string());
        fake.found_in_other_account = true;

        let report = run(&fake, &args("job-00000abc")).await.expect("report");
        let json = parse(&report);

        assert!(fake.calls().found_ids.contains(&"job-00000abc".to_string()));
        assert_eq!(json["foundInOtherAccount"], true);
        assert_eq!(json["job"]["id"], "job-00000abc");
        assert_eq!(json["account"]["name"], "My Second Account");
    }

    #[tokio::test]
    async fn normalizes_a_spark_prefixed_id_before_searching() {
        let mut job = failed_job("job-00000abc");
        job.state = "COMPLETED".to_string();
        let fake = Fake::new(job);

        run(&fake, &args("  spark-job-00000abc  "))
            .await
            .expect("report");

        assert_eq!(fake.calls().found_ids, vec!["job-00000abc".to_string()]);
    }

    #[tokio::test]
    async fn short_circuits_on_a_completed_job_without_fetching_logs() {
        let mut job = failed_job("job-ok");
        job.state = "COMPLETED".to_string();
        job.finished_at = Some("2026-08-01T10:30:00.000Z".to_string());
        let fake = Fake::new(job);

        let report = run(&fake, &args("job-ok")).await.expect("report");
        let json = parse(&report);

        assert_eq!(json["ok"], true);
        let calls = fake.calls();
        assert!(calls.listed_s3.is_empty(), "no S3 listing for a completed job");
        assert!(calls.cloud_watch.is_empty(), "no CloudWatch fetch either");
    }

    #[tokio::test]
    async fn prefers_s3_logs_with_the_exact_ui_prefix() {
        let mut job = failed_job("job-s3");
        job.configuration_overrides = Some(s3_only_overrides());
        let mut fake = Fake::new(job);
        fake.s3_objects = vec![
            LogObject {
                s3_key: "path/vc-1/jobs/job-s3/driver-stderr".to_string(),
                log_type: "driver".to_string(),
            },
            LogObject {
                s3_key: "path/vc-1/jobs/job-s3/driver-stdout".to_string(),
                log_type: "driver".to_string(),
            },
        ];
        fake.s3_contents = vec![(
            "stderr".to_string(),
            concat!(
                "23/08/01 10:00:01 INFO TaskSetManager: Starting task\n",
                "23/08/01 10:00:02 ERROR SparkContext: Job aborted\n",
                "Caused by: java.lang.OutOfMemoryError: Java heap space",
            )
            .to_string(),
        )];
        fake.cloud_watch_fails = true;

        let report = run(&fake, &args("job-s3")).await.expect("report");
        let json = parse(&report);

        // Same prefix the desktop Logs page builds — no leading "/" that would
        // match no real S3 key.
        assert_eq!(
            fake.calls().listed_s3,
            vec![(
                "my-log-bucket".to_string(),
                "path/vc-1/jobs/job-s3/".to_string()
            )]
        );
        assert_eq!(json["evidence"]["logSource"], "s3");
        assert!(fake.calls().read_keys.iter().any(|k| k.contains("stderr")));
        assert!(
            json["evidence"]["deepestCausedBy"]
                .as_str()
                .unwrap_or_default()
                .contains("OutOfMemoryError")
        );
        assert!(
            json["evidence"]["candidateCauses"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["cause"].as_str().unwrap_or_default().contains("OOM"))
        );
        // The noise-filtered log text is returned too, so the caller can always
        // judge beyond the heuristic fields.
        let raw = json["evidence"]["rawLogs"].as_str().unwrap_or_default();
        assert!(raw.contains("ERROR SparkContext: Job aborted"));
        assert!(raw.contains("Caused by: java.lang.OutOfMemoryError: Java heap space"));
    }

    #[tokio::test]
    async fn falls_back_to_cloud_watch_when_s3_yields_nothing() {
        let mut job = failed_job("job-cw");
        job.configuration_overrides = Some(s3_only_overrides());
        let mut fake = Fake::new(job);
        fake.s3_objects = Vec::new();
        fake.cloud_watch_events = vec![LogEvent {
            message: "23/08/01 10:00:02 ERROR SparkContext: Job failed".to_string(),
            stream_name: "driver-stderr".to_string(),
        }];

        let report = run(&fake, &args("job-cw")).await.expect("report");
        let json = parse(&report);
        assert_eq!(json["evidence"]["logSource"], "cloudwatch");
    }

    #[tokio::test]
    async fn uses_the_conventional_group_without_a_monitoring_config() {
        let fake = {
            let mut fake = Fake::new(failed_job("job-plain"));
            fake.cloud_watch_events = vec![LogEvent {
                message: "23/08/01 ERROR SparkContext: failed".to_string(),
                stream_name: "driver-stderr".to_string(),
            }];
            fake
        };

        let report = run(&fake, &args("job-plain")).await.expect("report");
        let json = parse(&report);

        assert_eq!(
            fake.calls().cloud_watch,
            vec![(
                "/aws/emr-containers/jobs/job-plain".to_string(),
                "job-plain".to_string()
            )]
        );
        assert_eq!(json["evidence"]["logSource"], "cloudwatch");
    }

    #[tokio::test]
    async fn probes_the_conventional_group_for_an_empty_s3_archive() {
        let mut job = failed_job("job-s3only");
        job.configuration_overrides = Some(s3_only_overrides());
        let mut fake = Fake::new(job);
        fake.cloud_watch_events = vec![LogEvent {
            message: "23/08/01 ERROR SparkContext: failed".to_string(),
            stream_name: "driver-stderr".to_string(),
        }];

        let report = run(&fake, &args("job-s3only")).await.expect("report");
        let json = parse(&report);

        assert_eq!(
            fake.calls().cloud_watch,
            vec![(
                "/aws/emr-containers/jobs/job-s3only".to_string(),
                "job-s3only".to_string()
            )]
        );
        assert_eq!(json["evidence"]["logSource"], "cloudwatch");
    }

    #[tokio::test]
    async fn returns_raw_logs_and_guidance_when_heuristics_find_nothing() {
        let mut job = failed_job("job-noev");
        job.configuration_overrides = Some(s3_only_overrides());
        let mut fake = Fake::new(job);
        fake.s3_objects = vec![LogObject {
            s3_key: "path/vc-1/jobs/job-noev/driver-stderr".to_string(),
            log_type: "driver".to_string(),
        }];
        fake.s3_contents = vec![(
            "stderr".to_string(),
            concat!(
                "application output line one\n",
                "23/08/01 10:00:05 INFO ApplicationMaster: preparing to shut down\n",
                "some unstructured shutdown notice without any exception markers",
            )
            .to_string(),
        )];
        fake.cloud_watch_fails = true;

        let report = run(&fake, &args("job-noev")).await.expect("report");
        let json = parse(&report);

        // Heuristics found nothing...
        assert_eq!(json["evidence"]["errorTail"].as_array().unwrap().len(), 0);
        assert_eq!(json["evidence"]["tracebacks"].as_array().unwrap().len(), 0);
        assert!(json["evidence"]["deepestCausedBy"].is_null());
        assert_eq!(
            json["evidence"]["candidateCauses"].as_array().unwrap().len(),
            0
        );
        // ...but the caller still gets the noise-filtered, sanitized logs.
        assert_eq!(json["evidence"]["logSource"], "s3");
        let raw = json["evidence"]["rawLogs"].as_str().unwrap_or_default();
        assert!(raw.contains("application output line one"));
        assert!(raw.contains("unstructured shutdown notice"));
        // Routine INFO noise is filtered out of the raw evidence.
        assert!(!raw.contains("INFO ApplicationMaster"));
        assert_eq!(json["evidence"]["truncated"], false);
        assert!(
            json["summary"]
                .as_str()
                .unwrap_or_default()
                .contains("rawLogs")
        );
    }

    #[tokio::test]
    async fn collects_control_logs_as_controller_evidence() {
        let mut job = failed_job("job-ctl");
        job.configuration_overrides = Some(s3_only_overrides());
        let mut fake = Fake::new(job);
        fake.s3_objects = vec![
            LogObject {
                s3_key: "path/vc-1/jobs/job-ctl/control-logs/job-ctl-qs8tm/stderr.gz"
                    .to_string(),
                log_type: "controller".to_string(),
            },
            LogObject {
                s3_key: "path/vc-1/jobs/job-ctl/containers/spark-job-ctl/spark-job-ctl-driver/stderr.gz".to_string(),
                log_type: "driver".to_string(),
            },
        ];
        fake.s3_contents = vec![
            (
                "control-logs".to_string(),
                concat!(
                    "2026-08-01T10:00:00Z Failed to pull image \"my-registry/spark:1.0\": ErrImagePull\n",
                    "2026-08-01T10:00:05Z ERROR pod spark-job-ctl-driver failed to start",
                )
                .to_string(),
            ),
            (
                "containers".to_string(),
                concat!(
                    "23/08/01 10:00:01 INFO TaskSetManager: Starting task\n",
                    "23/08/01 10:00:02 ERROR SparkContext: Job aborted",
                )
                .to_string(),
            ),
        ];
        fake.cloud_watch_fails = true;

        let report = run(&fake, &args("job-ctl")).await.expect("report");
        let json = parse(&report);

        // Both tiers are read from the single listing.
        let calls = fake.calls();
        assert!(calls.read_keys.iter().any(|k| k.contains("/control-logs/")));
        assert!(calls.read_keys.iter().any(|k| k.contains("/containers/")));
        drop(calls);

        // Controller evidence is reported separately, not mixed into the
        // application logs.
        assert_eq!(json["controllerEvidence"]["logSource"], "s3");
        let controller_raw = json["controllerEvidence"]["rawLogs"]
            .as_str()
            .unwrap_or_default();
        assert!(controller_raw.contains("ErrImagePull"));
        assert!(
            json["controllerEvidence"]["errorTail"]
                .as_array()
                .unwrap()
                .iter()
                .any(|l| l.as_str().unwrap_or_default().contains("failed to start"))
        );
        let app_raw = json["evidence"]["rawLogs"].as_str().unwrap_or_default();
        assert!(app_raw.contains("ERROR SparkContext: Job aborted"));
        assert!(!app_raw.contains("ErrImagePull"));
    }

    #[tokio::test]
    async fn reports_controller_causes_ahead_of_application_causes() {
        let mut job = failed_job("job-oomkill");
        job.configuration_overrides = Some(s3_only_overrides());
        let mut fake = Fake::new(job);
        fake.s3_objects = vec![LogObject {
            s3_key: "path/vc-1/jobs/job-oomkill/control-logs/job-oomkill-ab12c/stderr.gz"
                .to_string(),
            log_type: "controller".to_string(),
        }];
        fake.s3_contents = vec![(
            "control-logs".to_string(),
            "2026-08-01T10:00:00Z ERROR container OOMKilled: exceeded memory limit".to_string(),
        )];

        let report = run(&fake, &args("job-oomkill")).await.expect("report");
        let json = parse(&report);

        assert!(
            json["controllerEvidence"]["candidateCauses"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["cause"].as_str().unwrap_or_default().contains("OOM"))
        );
        assert!(
            json["summary"]
                .as_str()
                .unwrap_or_default()
                .contains("Controller (pod-level) causes")
        );
        // No application logs existed, but the pod-level cause still surfaced.
        assert_eq!(json["evidence"]["logSource"], "none");
    }

    #[tokio::test]
    async fn splits_cloud_watch_streams_into_both_tiers_in_one_fetch() {
        let mut fake = Fake::new(failed_job("job-cwsplit"));
        fake.cloud_watch_events = vec![
            LogEvent {
                message: "ERROR pod job-cwsplit-ab12c: ErrImagePull".to_string(),
                stream_name: "job-cwsplit-ab12c/stderr".to_string(),
            },
            LogEvent {
                message: "23/08/01 ERROR SparkContext: Job aborted".to_string(),
                stream_name: "spark-job-cwsplit-driver/stderr".to_string(),
            },
        ];

        let report = run(&fake, &args("job-cwsplit")).await.expect("report");
        let json = parse(&report);

        // One CloudWatch fetch serves both tiers — no duplicate AWS calls.
        assert_eq!(fake.calls().cloud_watch.len(), 1);

        assert_eq!(json["controllerEvidence"]["logSource"], "cloudwatch");
        assert!(
            json["controllerEvidence"]["rawLogs"]
                .as_str()
                .unwrap_or_default()
                .contains("ErrImagePull")
        );
        assert_eq!(json["evidence"]["logSource"], "cloudwatch");
        let app_raw = json["evidence"]["rawLogs"].as_str().unwrap_or_default();
        assert!(app_raw.contains("ERROR SparkContext: Job aborted"));
        assert!(!app_raw.contains("ErrImagePull"));
    }

    // --- Job id validation ------------------------------------------------

    #[tokio::test]
    async fn rejects_a_malformed_job_id_without_searching() {
        let mut fake = Fake::new(failed_job("unused"));
        // Any lookup would error, proving none was attempted.
        fake.find_fails = true;

        // A truncated id — the common failure mode when a model copies it along.
        let report = run(&fake, &args("0000000381pbkl")).await.expect("report");
        let json = parse(&report);

        let calls = fake.calls();
        assert!(calls.found_ids.is_empty(), "no search for a malformed id");
        assert!(calls.described.is_empty());
        assert!(calls.listed_s3.is_empty());
        assert!(calls.cloud_watch.is_empty());
        drop(calls);

        assert_eq!(json["ok"], false);
        assert_eq!(json["error"], "invalidJobId");
        assert_eq!(json["providedJobId"], "0000000381pbkl");
        assert!(
            json["summary"]
                .as_str()
                .unwrap_or_default()
                .contains("truncated")
        );
        assert!(
            json["nextStep"]
                .as_str()
                .unwrap_or_default()
                .contains("Ask the user")
        );
    }

    #[tokio::test]
    async fn rejects_ids_that_are_clearly_not_emr_job_ids() {
        let mut fake = Fake::new(failed_job("unused"));
        fake.find_fails = true;

        for bad in [
            "my failed job",
            "the job from yesterday",
            "0000000381T77O3G8F5x",
        ] {
            let report = run(&fake, &args(bad)).await.expect("report");
            assert_eq!(parse(&report)["error"], "invalidJobId", "input: {bad}");
        }
    }

    #[tokio::test]
    async fn accepts_well_formed_ids_with_or_without_the_spark_prefix() {
        let mut job = failed_job("unused");
        job.state = "COMPLETED".to_string();
        let fake = Fake::new(job);

        for input in [
            "0000000381t77o3g8f5",
            "spark-0000000381t77o3g8f5",
            "job-abc-123",
        ] {
            run(&fake, &args(input)).await.expect("report");
        }

        assert_eq!(
            *fake.calls().found_ids,
            vec![
                "0000000381t77o3g8f5".to_string(),
                "0000000381t77o3g8f5".to_string(),
                "job-abc-123".to_string(),
            ]
        );
    }
}




