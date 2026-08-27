//! The real [`JobDataSource`]: the MCP tools' view of AWS, backed by the app's
//! own SDK clients and SQLite job history.
//!
//! This replaces the old Node→HTTP bridge (`mcp_bridge.rs`): the tools now call
//! straight into the same code paths the desktop UI uses, so there is no
//! cross-process DTO to keep in sync.

use tauri::AppHandle;

use crate::aws::runtime::runtime_for_context;
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::mcp::tools::analyze_job_failure::{
    FoundJob, JobDataSource, JobRef, LogEvent, LogObject,
};
use crate::models::{AwsCommandContext, JobRunSummary};

/// Bounded pagination, matching the limit the app uses elsewhere so a huge
/// account cannot loop forever.
const MAX_EMR_PAGINATION_PAGES: usize = 100;

/// The production [`JobDataSource`]: the MCP tools' view of AWS, backed by the
/// app's own SDK clients and SQLite job history.
///
/// This replaces the old Node→HTTP bridge (`mcp_bridge.rs`): the tools now call
/// straight into the same code paths the desktop UI uses, so there is no
/// cross-process DTO to keep in sync.
///
/// The wrapper holds an `Option<AppHandle>` so a raw variant can be built for
/// unit tests, where no real Tauri runtime exists. Tool methods check the
/// handle before touching it and return a readable error instead of panicking.
pub struct AppJobDataSource {
    app: Option<AppHandle>,
}

impl AppJobDataSource {
    pub fn new(app: AppHandle) -> Self {
        Self { app: Some(app) }
    }

    /// Construct a data source for tests that never reach AWS: every tool
    /// fails with a "no app handle" error rather than panicking, which is what
    /// the transport tests assert on (they only verify the handshake and tool
    /// advertisement).
    #[doc(hidden)]
    #[cfg(test)]
    pub fn new_unavailable_for_test() -> Self {
        Self { app: None }
    }

    fn handle(&self) -> AppResult<&AppHandle> {
        self.app
            .as_ref()
            .ok_or_else(|| AppError::internal("MCP data source has no app handle (test mode)."))
    }
}

/// Project a job-history row into the shape the tools consume.
fn job_ref_from_summary(job: &JobRunSummary) -> JobRef {
    let describe = job.describe_details.as_ref();
    JobRef {
        id: job.id.clone(),
        name: Some(job.name.clone()).filter(|name| !name.is_empty()),
        state: job.state.clone(),
        virtual_cluster_id: job.virtual_cluster_id.clone(),
        created_at: Some(job.created_at.clone()).filter(|value| !value.is_empty()),
        finished_at: job.finished_at.clone(),
        started_at: job.started_at.clone(),
        failure_reason: describe.and_then(|d| d.failure_reason.clone()),
        state_details: describe.and_then(|d| d.state_details.clone()),
        release_label: describe.and_then(|d| d.release_label.clone()),
        configuration_overrides: describe.and_then(|d| d.configuration_overrides.clone()),
    }
}

impl JobDataSource for AppJobDataSource {
    /// Locate a job by id across every configured account, active account first.
    ///
    /// For each account: check the app's local job-history cache, then enumerate
    /// that account's virtual clusters (all states, so TERMINATED clusters are
    /// searched too) and `DescribeJobRun` each one. The first hit wins and is
    /// cached in job_history.
    ///
    /// Account/credential errors are logged and skipped rather than aborting the
    /// search, so one misconfigured account can't block lookup in the others.
    async fn find_job(&self, job_id: &str) -> AppResult<FoundJob> {
        let pool = repository::pool().await?;
        let active = repository::active_aws_account(&pool).await?;
        let mut accounts = repository::list_aws_accounts(&pool).await?;
        // Active account first so it is always searched before the others.
        if let Some(active) = active {
            if let Some(index) = accounts.iter().position(|a| a.id == active.id) {
                let account = accounts.remove(index);
                accounts.insert(0, account);
            }
        }

        for account in accounts {
            // 1. Local cache first. Job ids are matched exactly; no prefix
            //    matching is allowed anywhere.
            if let Ok(history) =
                repository::list_job_history(&pool, Some(&account.id), None, None).await
            {
                if let Some(job) = history.into_iter().find(|job| job.id == job_id) {
                    return Ok(FoundJob {
                        job: job_ref_from_summary(&job),
                        account_id: Some(account.id.clone()),
                        account_name: Some(account.name.clone()),
                        region: Some(account.region.clone()),
                        found_in_other_account: !account.is_active,
                    });
                }
            }

            // 2. Enumerate virtual clusters and probe each one via AWS.
            let runtime = match runtime_for_context(
                self.handle()?,
                AwsCommandContext {
                    account_id: Some(account.id.clone()),
                },
            )
            .await
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    crate::diagnostics::append_log_line(
                        "WARN",
                        &format!(
                            "mcp find_job: skipping account {} ({}): {error}",
                            account.name, account.id
                        ),
                    );
                    continue;
                }
            };
            let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
            let cluster_ids = match list_virtual_cluster_ids(&client).await {
                Ok(ids) => ids,
                Err(error) => {
                    crate::diagnostics::append_log_line(
                        "WARN",
                        &format!(
                            "mcp find_job: skipping account {} ({}): {error}",
                            account.name, account.id
                        ),
                    );
                    continue;
                }
            };

            for cluster_id in cluster_ids {
                let Ok(response) = client
                    .describe_job_run()
                    .id(job_id)
                    .virtual_cluster_id(&cluster_id)
                    .send()
                    .await
                else {
                    continue;
                };
                let Some(job_run) = response.job_run() else {
                    continue;
                };
                let mut job = crate::commands::emr::map_job_run(
                    job_run,
                    Some(account.id.clone()),
                    Some(account.region.clone()),
                );
                // Enrich with the monitoring config, which is what resolves the
                // job's S3/CloudWatch log destinations.
                if let Some(overrides) = job_run
                    .configuration_overrides()
                    .and_then(crate::commands::emr::map_configuration_overrides)
                {
                    if let Some(details) = &mut job.describe_details {
                        details.configuration_overrides = Some(overrides);
                    }
                }
                repository::upsert_job_history(&pool, &job).await?;
                return Ok(FoundJob {
                    job: job_ref_from_summary(&job),
                    account_id: Some(account.id.clone()),
                    account_name: Some(account.name.clone()),
                    region: Some(account.region.clone()),
                    found_in_other_account: !account.is_active,
                });
            }
        }

        Err(AppError::validation(format!(
            "Job {job_id} was not found in any configured account."
        )))
    }

    async fn describe_job(
        &self,
        account_id: Option<&str>,
        job_id: &str,
        virtual_cluster_id: &str,
    ) -> AppResult<JobRef> {
        // Delegate to the same command the desktop UI uses: it resolves the job
        // via AWS when a cluster id is given and falls back to local history.
        let job = crate::commands::emr::describe_job_run(
            self.handle()?.clone(),
            crate::models::JobRunRequest {
                account_id: account_id.map(ToString::to_string),
                id: Some(job_id.to_string()),
                virtual_cluster_id: Some(virtual_cluster_id.to_string()),
                keyword: None,
                next_token: None,
                max_results: None,
                created_after_days: None,
            },
        )
        .await?;
        Ok(job_ref_from_summary(&job))
    }

    async fn list_s3_objects(
        &self,
        account_id: Option<&str>,
        bucket: &str,
        prefix: &str,
    ) -> AppResult<Vec<LogObject>> {
        let runtime = runtime_for_context(
            self.handle()?,
            AwsCommandContext {
                account_id: account_id.map(ToString::to_string),
            },
        )
        .await?;
        let client = aws_sdk_s3::Client::new(&runtime.config);

        let response = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .send()
            .await
            .map_err(|error| AppError::aws_sdk("s3", error))?;

        // Classify each object the same way the desktop Logs page does, so the
        // tool can tell controller (control-logs/…) from driver/executor pods.
        let job_id = crate::emr_log_path::job_id_from_prefix(prefix).unwrap_or_default();
        let mut objects = Vec::new();
        for object in response.contents() {
            let key = object.key().unwrap_or_default();
            if key.is_empty() || key.ends_with('/') {
                continue;
            }
            if object.size() == Some(0) {
                continue;
            }
            let normalized_key = key.strip_suffix(".gz").unwrap_or(key);
            let log_type = crate::emr_log_path::parse_emr_log_path(normalized_key, &job_id)
                .map(|parsed| parsed.log_type)
                // Objects outside the pod-log subtrees (e.g. job-metadata.log)
                // have no pod identity; keep them listed but unclassified.
                .unwrap_or_else(|| "sparkLog".to_string());
            objects.push(LogObject {
                s3_key: key.to_string(),
                log_type,
            });
        }
        Ok(objects)
    }

    async fn get_s3_object(
        &self,
        account_id: Option<&str>,
        bucket: &str,
        key: &str,
    ) -> AppResult<String> {
        let runtime = runtime_for_context(
            self.handle()?,
            AwsCommandContext {
                account_id: account_id.map(ToString::to_string),
            },
        )
        .await?;
        let client = aws_sdk_s3::Client::new(&runtime.config);

        let response = client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| AppError::aws_sdk("s3", error))?;
        let bytes = response
            .body
            .collect()
            .await
            .map_err(|error| AppError::internal(format!("Failed to read S3 object: {error}")))?
            .into_bytes();

        decode_s3_text_object(key, bytes.as_ref())
    }

    async fn get_logs(
        &self,
        account_id: Option<&str>,
        job_id: &str,
        log_group_name: &str,
        stream_name_prefix: &str,
        limit: i32,
    ) -> AppResult<Vec<LogEvent>> {
        let runtime = runtime_for_context(
            self.handle()?,
            AwsCommandContext {
                account_id: account_id.map(ToString::to_string),
            },
        )
        .await?;
        let client = aws_sdk_cloudwatchlogs::Client::new(&runtime.config);

        let log_group = if log_group_name.is_empty() {
            format!("/aws/emr-containers/jobs/{job_id}")
        } else {
            log_group_name.to_string()
        };

        let mut operation = client
            .filter_log_events()
            .log_group_name(&log_group)
            .limit(limit);
        if !stream_name_prefix.is_empty() {
            operation = operation.log_stream_name_prefix(stream_name_prefix);
        }

        let response = operation
            .send()
            .await
            .map_err(|error| AppError::aws_sdk("cloudwatchlogs", error))?;

        Ok(response
            .events()
            .iter()
            .filter_map(|event| {
                Some(LogEvent {
                    message: event.message()?.to_string(),
                    stream_name: event.log_stream_name().unwrap_or_default().to_string(),
                })
            })
            .collect())
    }
}

/// List the ids of all virtual clusters in an account, across every state
/// (RUNNING, TERMINATED, …) and all pages.
async fn list_virtual_cluster_ids(
    client: &aws_sdk_emrcontainers::Client,
) -> AppResult<Vec<String>> {
    let mut ids = Vec::new();
    let mut next_token: Option<String> = None;
    let mut pages = 0usize;

    loop {
        pages += 1;
        if pages > MAX_EMR_PAGINATION_PAGES {
            crate::diagnostics::append_log_line(
                "WARN",
                "mcp find_job: stopped ListVirtualClusters pagination after reaching the page limit.",
            );
            break;
        }

        let mut operation = client.list_virtual_clusters();
        if let Some(token) = next_token.as_deref() {
            operation = operation.next_token(token);
        }
        let response = operation
            .send()
            .await
            .map_err(|error| AppError::aws_for_account_sdk("emr-containers", "unknown", error))?;

        ids.extend(
            response
                .virtual_clusters()
                .iter()
                .filter_map(|cluster| cluster.id().map(ToString::to_string)),
        );

        next_token = response.next_token().map(String::from);
        if next_token.is_none() {
            break;
        }
    }

    Ok(ids)
}

/// Decode an S3 object body to text, decompressing gzip when the key ends in
/// `.gz` or the content carries the gzip magic bytes — EMR on EKS archives
/// container logs compressed, so the tool would otherwise see binary.
fn decode_s3_text_object(key: &str, bytes: &[u8]) -> AppResult<String> {
    let is_gzip = key.ends_with(".gz") || bytes.starts_with(&[0x1f, 0x8b]);
    if is_gzip {
        let mut decoder = flate2::read::GzDecoder::new(bytes);
        let mut content = String::new();
        std::io::Read::read_to_string(&mut decoder, &mut content).map_err(|error| {
            AppError::validation(format!("Gzip log object is not valid text: {error}"))
        })?;
        return Ok(content);
    }
    Ok(String::from_utf8_lossy(bytes).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_gzip_and_plain_s3_objects() {
        use flate2::write::GzEncoder;
        use std::io::Write;

        let mut encoder = GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(b"ERROR SparkContext: boom").unwrap();
        let gzipped = encoder.finish().unwrap();

        // Suffix-driven and magic-byte-driven detection both decompress.
        assert_eq!(
            decode_s3_text_object("logs/driver/stderr.gz", &gzipped).unwrap(),
            "ERROR SparkContext: boom"
        );
        assert_eq!(
            decode_s3_text_object("logs/driver/stderr", &gzipped).unwrap(),
            "ERROR SparkContext: boom"
        );
        // Plain text passes through untouched.
        assert_eq!(
            decode_s3_text_object("logs/driver/stderr", b"plain line").unwrap(),
            "plain line"
        );
    }

    /// A job-history row carries its monitoring config inside
    /// `describeDetails.configurationOverrides`; the tools resolve log
    /// destinations from exactly that field, so the projection must preserve it.
    #[test]
    fn projects_a_job_summary_into_a_job_ref() {
        let overrides = serde_json::json!({
            "monitoringConfiguration": {
                "s3MonitoringConfiguration": {"logUri": "s3://bucket/logs/"}
            }
        });
        let summary = JobRunSummary {
            id: "job-1".to_string(),
            name: "nightly".to_string(),
            state: "FAILED".to_string(),
            account_id: Some("acct-1".to_string()),
            region: Some("us-east-1".to_string()),
            virtual_cluster_id: "vc-1".to_string(),
            virtual_cluster_name: None,
            created_at: "2026-08-01T10:00:00Z".to_string(),
            started_at: None,
            finished_at: Some("2026-08-01T10:05:00Z".to_string()),
            duration_seconds: Some(300),
            source_request: None,
            describe_details: Some(crate::models::JobRunDescribeDetails {
                arn: None,
                client_token: None,
                execution_role_arn: None,
                release_label: Some("emr-7.2.0-latest".to_string()),
                created_by: None,
                state_details: Some("pod failed".to_string()),
                failure_reason: Some("USER_ERROR".to_string()),
                tags: None,
                retry_max_attempts: None,
                retry_current_attempt_count: None,
                job_driver: None,
                configuration_overrides: Some(overrides.clone()),
            }),
        };

        let job = job_ref_from_summary(&summary);
        assert_eq!(job.id, "job-1");
        assert_eq!(job.state, "FAILED");
        assert_eq!(job.virtual_cluster_id, "vc-1");
        assert_eq!(job.failure_reason.as_deref(), Some("USER_ERROR"));
        assert_eq!(job.state_details.as_deref(), Some("pod failed"));
        assert_eq!(job.release_label.as_deref(), Some("emr-7.2.0-latest"));
        assert_eq!(job.configuration_overrides, Some(overrides));
    }
}
