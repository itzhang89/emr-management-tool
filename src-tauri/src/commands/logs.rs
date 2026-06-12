use crate::aws::runtime::runtime_for_context;
use crate::error::{AppError, AppResult};
use crate::models::{AwsCommandContext, JobLogsRequest, JobLogsResponse, LogEntry};
use chrono::{TimeZone, Utc};
use tauri::AppHandle;

#[tauri::command]
pub async fn get_job_logs(app: AppHandle, request: JobLogsRequest) -> AppResult<JobLogsResponse> {
    if request.job_id.trim().is_empty() {
        return Err(AppError::validation("Job id is required to load logs."));
    }

    let runtime = runtime_for_context(&app, AwsCommandContext {
        account_id: request.account_id.clone(),
    })
    .await?;
    let client = aws_sdk_cloudwatchlogs::Client::new(&runtime.config);
    let log_group_name = request
        .log_group_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("/aws/emr-containers/jobs/{}", request.job_id));
    let mut operation = client
        .filter_log_events()
        .log_group_name(log_group_name)
        .limit(request.limit.unwrap_or(500));

    if let Some(prefix) = request.stream_name_prefix.clone().filter(|value| !value.trim().is_empty()) {
        operation = operation.log_stream_name_prefix(prefix);
    }
    if let Some(token) = request.next_forward_token.clone() {
        operation = operation.next_token(token);
    }
    if let Some(pattern) = request.filter_pattern.clone().filter(|value| !value.trim().is_empty()) {
        operation = operation.filter_pattern(pattern);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("cloudwatchlogs", runtime.account.id, error))?;
    let entries = response
        .events()
        .iter()
        .map(|event| LogEntry {
            timestamp: event
                .timestamp()
                .and_then(|millis| Utc.timestamp_millis_opt(millis).single())
                .map(|timestamp| timestamp.to_rfc3339())
                .unwrap_or_default(),
            level: infer_level(event.message().unwrap_or_default()).to_string(),
            message: event.message().unwrap_or_default().to_string(),
            stream_name: event.log_stream_name().unwrap_or_default().to_string(),
        })
        .collect();

    Ok(JobLogsResponse {
        job_id: request.job_id,
        entries,
        next_forward_token: response.next_token().map(ToString::to_string),
    })
}

fn infer_level(message: &str) -> &'static str {
    let lower = message.to_lowercase();
    if lower.contains("error") || lower.contains("exception") {
        "error"
    } else if lower.contains("warn") {
        "warn"
    } else {
        "info"
    }
}
