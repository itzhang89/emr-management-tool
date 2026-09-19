//! MCP face for remediation runbooks: match a diagnosis context to advise
//! text, and (when an approved runbook allows it) auto-rerun an EMR job from
//! local history's stored StartJobRunRequest, or from a describe_job_run
//! sparkSubmit payload when history has no source request.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::emr;
use crate::db::repository;
use crate::db::runbooks::{self, MatchRunbooksContext, MatchedRunbook};
use crate::error::AppResult;
use crate::models::{
    JarApplicationConfig, JobDriverRequest, JobRunRequest, JobRunSummary, SparkResourceConfig,
    SparkSubmitJobDriverRequest, StartJobRunRequest,
};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchRunbooksArgs {
    #[serde(default)]
    pub job_name: Option<String>,
    #[serde(default)]
    pub error_summary: Option<String>,
    #[serde(default)]
    pub current_status: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub application_id: Option<String>,
    #[serde(default)]
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposeRerunJobArgs {
    /// EMR on EKS job run id (from history or find_job).
    pub job_id: String,
    #[serde(default)]
    pub job_name: Option<String>,
    #[serde(default)]
    pub current_status: Option<String>,
    #[serde(default)]
    pub error_summary: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeRerunJobResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ProposeRerunJobResult {
    pub fn refused(message: &str) -> Self {
        Self {
            ok: false,
            new_job_id: None,
            message: None,
            error: Some(message.to_string()),
        }
    }
}

pub async fn match_runbooks(args: &MatchRunbooksArgs) -> AppResult<Vec<MatchedRunbook>> {
    let pool = repository::pool().await?;
    runbooks::match_runbooks(
        &pool,
        &MatchRunbooksContext {
            job_name: args.job_name.clone(),
            error_summary: args.error_summary.clone(),
            current_status: args.current_status.clone(),
            project_name: args.project_name.clone(),
            application_id: args.application_id.clone(),
            job_id: args.job_id.clone(),
        },
    )
    .await
}

pub async fn propose_rerun_job(
    app: &AppHandle,
    args: &ProposeRerunJobArgs,
) -> AppResult<ProposeRerunJobResult> {
    let pool = repository::pool().await?;
    let matched = runbooks::match_runbooks(
        &pool,
        &MatchRunbooksContext {
            job_name: args.job_name.clone(),
            error_summary: args.error_summary.clone(),
            current_status: args.current_status.clone(),
            project_name: args.project_name.clone(),
            application_id: None,
            job_id: Some(args.job_id.clone()),
        },
    )
    .await?;

    if !matched.iter().any(|item| item.would_auto_rerun) {
        return Ok(ProposeRerunJobResult::refused(
            "No approved runbook allows auto-rerun for this diagnosis. \
             Approve a matching runbook on the AI Assistant → Runbooks tab, \
             or rerun manually from Job History.",
        ));
    }

    let history = repository::get_job_history(&pool, &args.job_id).await?;
    let request = match resolve_rerun_request(app, &args.job_id, history.as_ref()).await {
        Ok(request) => request,
        Err(message) => return Ok(ProposeRerunJobResult::refused(&message)),
    };

    let started = emr::start_job_run(app.clone(), request).await?;
    let new_job_id = started.id.clone();
    Ok(ProposeRerunJobResult {
        ok: true,
        new_job_id: Some(started.id),
        message: Some(format!(
            "Submitted a new job run named {} (id {new_job_id}).",
            started.name
        )),
        error: None,
    })
}

/// Prefer the stored StartJobRunRequest; otherwise describe the job and build a
/// minimal sparkSubmit start request (same idea as Job History → Rerun).
async fn resolve_rerun_request(
    app: &AppHandle,
    job_id: &str,
    history: Option<&JobRunSummary>,
) -> Result<StartJobRunRequest, String> {
    if let Some(job) = history {
        if let Some(mut request) = job.source_request.clone() {
            request.account_id = job.account_id.clone();
            return Ok(request);
        }
    }

    let virtual_cluster_id = history
        .map(|job| job.virtual_cluster_id.clone())
        .filter(|id| !id.trim().is_empty());
    let account_id = history.and_then(|job| job.account_id.clone());

    let Some(virtual_cluster_id) = virtual_cluster_id else {
        return Err(
            "Job was not found in local history with a virtual cluster id, so it \
             cannot be auto-rerun. Use Job History → Rerun instead."
                .into(),
        );
    };

    let detailed = emr::describe_job_run(
        app.clone(),
        JobRunRequest {
            account_id: account_id.clone(),
            id: Some(job_id.to_string()),
            virtual_cluster_id: Some(virtual_cluster_id),
            keyword: None,
            next_token: None,
            max_results: None,
            created_after_days: None,
        },
    )
    .await
    .map_err(|error| {
        format!(
            "Failed to describe job for auto-rerun: {error}. Use Job History → Rerun instead."
        )
    })?;

    start_request_from_describe(&detailed).map_err(|message| {
        format!("{message} Use Job History → Rerun instead.")
    })
}

/// Build a StartJobRunRequest from describe details (sparkSubmit only).
fn start_request_from_describe(job: &JobRunSummary) -> Result<StartJobRunRequest, String> {
    let details = job
        .describe_details
        .as_ref()
        .ok_or_else(|| "Describe returned no job details.".to_string())?;
    let driver = details
        .job_driver
        .as_ref()
        .ok_or_else(|| "Describe returned no job driver.".to_string())?;
    let driver_type = driver
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if driver_type != "sparkSubmit" {
        return Err(format!(
            "Auto-rerun from describe currently supports sparkSubmit jobs only (got {driver_type})."
        ));
    }

    let entry_point = driver
        .get("entryPoint")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    if entry_point.trim().is_empty() {
        return Err("Describe did not include a sparkSubmit entryPoint.".into());
    }

    let entry_point_arguments = driver
        .get("entryPointArguments")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let spark_submit_parameters = driver
        .get("sparkSubmitParameters")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();

    let execution_role_arn = details
        .execution_role_arn
        .clone()
        .unwrap_or_default();
    let release_label = details.release_label.clone().unwrap_or_default();
    if execution_role_arn.trim().is_empty() || release_label.trim().is_empty() {
        return Err(
            "Describe is missing executionRoleArn or releaseLabel needed to restart the job."
                .into(),
        );
    }

    let main_class = spark_submit_parameters
        .split_whitespace()
        .skip_while(|token| *token != "--class")
        .nth(1)
        .unwrap_or("")
        .to_string();

    Ok(StartJobRunRequest {
        account_id: job.account_id.clone(),
        name: job.name.clone(),
        virtual_cluster_id: job.virtual_cluster_id.clone(),
        execution_role_arn,
        release_label,
        application: JarApplicationConfig {
            r#type: "jar".into(),
            jar_path: entry_point.clone(),
            main_class,
        },
        arguments: entry_point_arguments.clone(),
        resources: SparkResourceConfig {
            driver_cores: 1,
            driver_memory: "2G".into(),
            executor_cores: 1,
            executor_memory: "2G".into(),
            executor_instances: 1,
        },
        spark_config: Default::default(),
        job_driver: JobDriverRequest {
            spark_submit_job_driver: SparkSubmitJobDriverRequest {
                entry_point,
                entry_point_arguments,
                spark_submit_parameters,
            },
        },
        configuration_overrides: details.configuration_overrides.clone(),
        template_name: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::JobRunDescribeDetails;
    use chrono::Utc;

    fn spark_job(driver: serde_json::Value) -> JobRunSummary {
        JobRunSummary {
            id: "job-1".into(),
            name: "etl_batch".into(),
            state: "FAILED".into(),
            account_id: Some("acct".into()),
            region: Some("ap-southeast-1".into()),
            virtual_cluster_id: "vc-1".into(),
            virtual_cluster_name: None,
            created_at: Utc::now().to_rfc3339(),
            started_at: None,
            finished_at: None,
            duration_seconds: None,
            source_request: None,
            describe_details: Some(JobRunDescribeDetails {
                arn: None,
                client_token: None,
                execution_role_arn: Some("arn:aws:iam::1:role/EMR".into()),
                release_label: Some("emr-7.2.0-latest".into()),
                created_by: None,
                state_details: None,
                failure_reason: None,
                tags: None,
                retry_max_attempts: None,
                retry_current_attempt_count: None,
                job_driver: Some(driver),
                configuration_overrides: Some(serde_json::json!({
                    "applicationConfiguration": []
                })),
            }),
        }
    }

    #[test]
    fn describe_spark_submit_builds_a_start_request() {
        let request = start_request_from_describe(&spark_job(serde_json::json!({
            "type": "sparkSubmit",
            "entryPoint": "s3://bucket/app.jar",
            "entryPointArguments": ["--date", "2026-01-01"],
            "sparkSubmitParameters": "--class com.example.Main --conf spark.x=1"
        })))
        .expect("builds");
        assert_eq!(request.job_driver.spark_submit_job_driver.entry_point, "s3://bucket/app.jar");
        assert_eq!(
            request.job_driver.spark_submit_job_driver.entry_point_arguments,
            vec!["--date", "2026-01-01"]
        );
        assert_eq!(request.application.main_class, "com.example.Main");
        assert_eq!(request.execution_role_arn, "arn:aws:iam::1:role/EMR");
    }

    #[test]
    fn describe_non_spark_submit_is_refused() {
        let err = start_request_from_describe(&spark_job(serde_json::json!({
            "type": "sparkSql",
            "sparkSqlParameters": "SELECT 1"
        })))
        .expect_err("refused");
        assert!(err.contains("sparkSubmit"), "{err}");
    }
}
