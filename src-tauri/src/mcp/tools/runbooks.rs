//! MCP face for remediation runbooks: match a diagnosis context to advise
//! text, and (when an approved runbook allows it) auto-rerun an EMR job from
//! local history's stored StartJobRunRequest.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::emr;
use crate::db::repository;
use crate::db::runbooks::{self, MatchRunbooksContext, MatchedRunbook};
use crate::error::{AppError, AppResult};

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

    let job = repository::get_job_history(&pool, &args.job_id)
        .await?
        .ok_or_else(|| {
            AppError::validation(
                "Job was not found in local history. Only jobs submitted from this app \
                 (with a stored source request) can be auto-rerun.",
            )
        })?;

    let Some(mut request) = job.source_request else {
        return Ok(ProposeRerunJobResult::refused(
            "This job has no stored StartJobRunRequest. Use Job History → Rerun \
             (describe path) instead.",
        ));
    };

    request.account_id = job.account_id.clone();
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
