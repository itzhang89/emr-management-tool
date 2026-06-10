use crate::aws::runtime::runtime_for_context;
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, JobRunRequest, JobRunSummary, ListVirtualClustersRequest, ListVirtualClustersResponse,
    StartJobRunRequest, VirtualCluster,
};
use aws_sdk_emrcontainers::types::{ContainerInfo, JobDriver, SparkSubmitJobDriver};
use chrono::Utc;

#[tauri::command]
pub async fn list_virtual_clusters(request: ListVirtualClustersRequest) -> AppResult<ListVirtualClustersResponse> {
    let runtime = runtime_for_context(AwsCommandContext {
        account_id: request.account_id.clone(),
    })
    .await?;
    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    let mut operation = client.list_virtual_clusters();
    if let Some(next_token) = request.next_token {
        operation = operation.next_token(next_token);
    }
    if let Some(max_results) = request.max_results {
        operation = operation.max_results(max_results);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("emr-containers", runtime.account.id.clone(), error))?;

    let clusters = response
        .virtual_clusters()
        .iter()
        .map(map_virtual_cluster)
        .collect();

    Ok(ListVirtualClustersResponse {
        clusters,
        next_token: response.next_token().map(ToString::to_string),
    })
}

#[tauri::command]
pub async fn list_job_runs(_request: JobRunRequest) -> AppResult<Vec<JobRunSummary>> {
    let request = _request;
    let runtime = runtime_for_context(AwsCommandContext {
        account_id: request.account_id.clone(),
    })
    .await?;
    let pool = repository::pool().await?;
    let Some(virtual_cluster_id) = request.virtual_cluster_id else {
        return repository::list_job_history(&pool, Some(&runtime.account.id), None).await;
    };

    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    let mut operation = client.list_job_runs().virtual_cluster_id(&virtual_cluster_id);
    if let Some(next_token) = request.next_token {
        operation = operation.next_token(next_token);
    }
    if let Some(max_results) = request.max_results {
        operation = operation.max_results(max_results);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("emr-containers", runtime.account.id.clone(), error))?;
    let jobs: Vec<JobRunSummary> = response
        .job_runs()
        .iter()
        .map(|job| map_job_run(job, Some(runtime.account.id.clone()), Some(runtime.account.region.clone())))
        .collect();
    for job in &jobs {
        repository::upsert_job_history(&pool, job).await?;
    }

    Ok(jobs)
}

#[tauri::command]
pub async fn describe_job_run(request: JobRunRequest) -> AppResult<JobRunSummary> {
    let account_id = request.account_id.clone();
    let id = request
        .id
        .ok_or_else(|| AppError::validation("Job id is required."))?;
    let runtime = runtime_for_context(AwsCommandContext { account_id }).await?;

    let pool = repository::pool().await?;
    let Some(virtual_cluster_id) = request.virtual_cluster_id else {
        return repository::list_job_history(&pool, Some(&runtime.account.id), None)
            .await?
            .into_iter()
            .find(|job| job.id == id)
            .ok_or_else(|| AppError::validation(format!("Job {id} was not found in local history.")));
    };

    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    let response = client
        .describe_job_run()
        .id(&id)
        .virtual_cluster_id(&virtual_cluster_id)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("emr-containers", runtime.account.id.clone(), error))?;
    let job_run = response
        .job_run()
        .ok_or_else(|| AppError::validation(format!("Job {id} was not returned by EMR.")))?;
    let job = map_job_run(job_run, Some(runtime.account.id), Some(runtime.account.region));
    repository::upsert_job_history(&pool, &job).await?;
    Ok(job)
}

#[tauri::command]
pub async fn start_job_run(request: StartJobRunRequest) -> AppResult<JobRunSummary> {
    validate_start_job_request(&request)?;
    let runtime = runtime_for_context(AwsCommandContext {
        account_id: request.account_id.clone(),
    })
    .await?;
    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    let job_driver = build_job_driver(&request)?;
    let client_token = uuid::Uuid::new_v4().to_string();
    let virtual_cluster_id = request.virtual_cluster_id.clone();
    let response = client
        .start_job_run()
        .name(request.name.clone())
        .virtual_cluster_id(request.virtual_cluster_id.clone())
        .client_token(client_token)
        .execution_role_arn(request.execution_role_arn.clone())
        .release_label(request.release_label.clone())
        .job_driver(job_driver)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("emr-containers", runtime.account.id.clone(), error))?;
    let now = Utc::now();
    let job = JobRunSummary {
        id: response
            .id()
            .ok_or_else(|| AppError::validation("StartJobRun did not return a job id."))?
            .to_string(),
        name: response.name().unwrap_or(&request.name).to_string(),
        state: "SUBMITTED".to_string(),
        account_id: Some(runtime.account.id),
        region: Some(runtime.account.region),
        virtual_cluster_id: response.virtual_cluster_id().unwrap_or(&virtual_cluster_id).to_string(),
        virtual_cluster_name: None,
        created_at: now.to_rfc3339(),
        started_at: Some(now.to_rfc3339()),
        finished_at: None,
        duration_seconds: None,
        source_request: Some(request),
    };

    let pool = repository::pool().await?;
    repository::upsert_job_history(&pool, &job).await?;

    Ok(job)
}

#[tauri::command]
pub async fn cancel_job_run(request: JobRunRequest) -> AppResult<JobRunSummary> {
    let account_id = request.account_id.clone();
    let id = request
        .id
        .ok_or_else(|| AppError::validation("Job id is required."))?;
    let virtual_cluster_id = request
        .virtual_cluster_id
        .ok_or_else(|| AppError::validation("Virtual cluster id is required."))?;
    let runtime = runtime_for_context(AwsCommandContext { account_id }).await?;
    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    client
        .cancel_job_run()
        .id(&id)
        .virtual_cluster_id(&virtual_cluster_id)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("emr-containers", runtime.account.id.clone(), error))?;

    let pool = repository::pool().await?;
    let mut job = repository::list_job_history(&pool, Some(&runtime.account.id), Some(&virtual_cluster_id))
        .await?
        .into_iter()
        .find(|job| job.id == id)
        .unwrap_or_else(|| JobRunSummary {
            id: id.clone(),
            name: id.clone(),
            state: "CANCELLED".to_string(),
            account_id: Some(runtime.account.id.clone()),
            region: Some(runtime.account.region.clone()),
            virtual_cluster_id: virtual_cluster_id.clone(),
            virtual_cluster_name: None,
            created_at: Utc::now().to_rfc3339(),
            started_at: None,
            finished_at: None,
            duration_seconds: None,
            source_request: None,
        });
    job.state = "CANCELLED".to_string();
    job.finished_at = Some(Utc::now().to_rfc3339());
    repository::upsert_job_history(&pool, &job).await?;

    Ok(job)
}

fn build_job_driver(request: &StartJobRunRequest) -> AppResult<JobDriver> {
    let spark_driver = SparkSubmitJobDriver::builder()
        .entry_point(request.job_driver.spark_submit_job_driver.entry_point.clone())
        .set_entry_point_arguments(Some(
            request
                .job_driver
                .spark_submit_job_driver
                .entry_point_arguments
                .clone(),
        ))
        .spark_submit_parameters(request.job_driver.spark_submit_job_driver.spark_submit_parameters.clone())
        .build()
        .map_err(|error| AppError::validation(error.to_string()))?;

    Ok(JobDriver::builder().spark_submit_job_driver(spark_driver).build())
}

fn validate_start_job_request(request: &StartJobRunRequest) -> AppResult<()> {
    if request.application.r#type != "jar" {
        return Err(AppError::validation("Only Jar applications are supported."));
    }
    if !request.application.jar_path.starts_with("s3://") {
        return Err(AppError::validation("Jar Path must be an S3 URI."));
    }
    if request.execution_role_arn.trim().is_empty() {
        return Err(AppError::validation("Execution role ARN is required."));
    }
    Ok(())
}

fn map_virtual_cluster(cluster: &aws_sdk_emrcontainers::types::VirtualCluster) -> VirtualCluster {
    let provider = cluster.container_provider();
    let namespace = provider
        .and_then(|provider| provider.info())
        .and_then(|info| match info {
            ContainerInfo::EksInfo(eks) => eks.namespace().map(ToString::to_string),
            _ => None,
        })
        .unwrap_or_else(|| "-".to_string());
    let eks_cluster_name = provider
        .map(|provider| provider.id().to_string())
        .unwrap_or_else(|| "-".to_string());

    VirtualCluster {
        id: cluster.id().unwrap_or_default().to_string(),
        name: cluster.name().unwrap_or_default().to_string(),
        state: cluster
            .state()
            .map(|state| state.as_str().to_string())
            .unwrap_or_else(|| "UNKNOWN".to_string()),
        namespace,
        eks_cluster_name,
        created_at: cluster
            .created_at()
            .map(|created_at| created_at.to_string())
            .unwrap_or_default(),
    }
}

fn map_job_run(
    job: &aws_sdk_emrcontainers::types::JobRun,
    account_id: Option<String>,
    region: Option<String>,
) -> JobRunSummary {
    JobRunSummary {
        id: job.id().unwrap_or_default().to_string(),
        name: job.name().unwrap_or_default().to_string(),
        state: job
            .state()
            .map(|state| state.as_str().to_string())
            .unwrap_or_else(|| "PENDING".to_string()),
        account_id,
        region,
        virtual_cluster_id: job.virtual_cluster_id().unwrap_or_default().to_string(),
        virtual_cluster_name: None,
        created_at: job
            .created_at()
            .map(|created_at| created_at.to_string())
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        started_at: None,
        finished_at: job.finished_at().map(|finished_at| finished_at.to_string()),
        duration_seconds: None,
        source_request: None,
    }
}
