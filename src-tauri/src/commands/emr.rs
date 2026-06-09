use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{JobRunRequest, JobRunSummary, RegionRequest, StartJobRunRequest, VirtualCluster};
use chrono::Utc;

#[tauri::command]
pub async fn list_virtual_clusters(_request: RegionRequest) -> AppResult<Vec<VirtualCluster>> {
    Ok(vec![
        VirtualCluster {
            id: "vc-prod".to_string(),
            name: "emr-prod".to_string(),
            state: "RUNNING".to_string(),
            namespace: "analytics".to_string(),
            eks_cluster_name: "eks-prod".to_string(),
            created_at: "2026-04-16T00:00:00Z".to_string(),
        },
        VirtualCluster {
            id: "vc-dev".to_string(),
            name: "emr-dev".to_string(),
            state: "RUNNING".to_string(),
            namespace: "sandbox".to_string(),
            eks_cluster_name: "eks-dev".to_string(),
            created_at: "2026-05-02T00:00:00Z".to_string(),
        },
    ])
}

#[tauri::command]
pub async fn list_job_runs(_request: JobRunRequest) -> AppResult<Vec<JobRunSummary>> {
    let pool = repository::pool().await?;
    repository::list_job_history(&pool).await
}

#[tauri::command]
pub async fn describe_job_run(request: JobRunRequest) -> AppResult<JobRunSummary> {
    let id = request
        .id
        .ok_or_else(|| AppError::Validation("Job id is required.".to_string()))?;

    let pool = repository::pool().await?;
    repository::list_job_history(&pool)
        .await?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| AppError::Validation(format!("Job {id} was not found in local history.")))
}

#[tauri::command]
pub async fn start_job_run(request: StartJobRunRequest) -> AppResult<JobRunSummary> {
    validate_start_job_request(&request)?;

    let now = Utc::now();
    let job = JobRunSummary {
        id: format!("job-{}", uuid::Uuid::new_v4()),
        name: request.name,
        state: "SUBMITTED".to_string(),
        virtual_cluster_id: request.virtual_cluster_id,
        virtual_cluster_name: None,
        created_at: now.to_rfc3339(),
        started_at: Some(now.to_rfc3339()),
        finished_at: None,
        duration_seconds: None,
    };

    let pool = repository::pool().await?;
    repository::upsert_job_history(&pool, &job).await?;

    Ok(job)
}

#[tauri::command]
pub async fn cancel_job_run(request: JobRunRequest) -> AppResult<JobRunSummary> {
    let id = request
        .id
        .ok_or_else(|| AppError::Validation("Job id is required.".to_string()))?;

    let pool = repository::pool().await?;
    let mut job = repository::list_job_history(&pool)
        .await?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| AppError::Validation(format!("Job {id} was not found in local history.")))?;
    job.state = "CANCELLED".to_string();
    job.finished_at = Some(Utc::now().to_rfc3339());
    repository::upsert_job_history(&pool, &job).await?;

    Ok(job)
}

fn validate_start_job_request(request: &StartJobRunRequest) -> AppResult<()> {
    if request.application.r#type != "jar" {
        return Err(AppError::Validation("Only Jar applications are supported.".to_string()));
    }
    if !request.application.jar_path.starts_with("s3://") {
        return Err(AppError::Validation("Jar Path must be an S3 URI.".to_string()));
    }
    if request.execution_role_arn.trim().is_empty() {
        return Err(AppError::Validation("Execution role ARN is required.".to_string()));
    }
    Ok(())
}
