use crate::error::{AppError, AppResult};
use crate::models::{JobLogsRequest, JobLogsResponse, LogEntry};

#[tauri::command]
pub async fn get_job_logs(request: JobLogsRequest) -> AppResult<JobLogsResponse> {
    if request.job_id.trim().is_empty() {
        return Err(AppError::Validation("Job id is required to load logs.".to_string()));
    }

    Ok(JobLogsResponse {
        job_id: request.job_id.clone(),
        entries: vec![
            LogEntry {
                timestamp: "2026-06-09T09:15:23Z".to_string(),
                level: "info".to_string(),
                message: format!("[{}] Starting Spark application", request.job_id),
                stream_name: "driver".to_string(),
            },
            LogEntry {
                timestamp: "2026-06-09T09:15:31Z".to_string(),
                level: "info".to_string(),
                message: "Allocated executors and initialized Spark context".to_string(),
                stream_name: "driver".to_string(),
            },
        ],
        next_forward_token: request.next_forward_token,
    })
}
