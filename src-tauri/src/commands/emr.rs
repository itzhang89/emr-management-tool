use crate::aws::runtime::runtime_for_context;
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, JobRunDescribeDetails, JobRunRequest, JobRunSummary,
    ListVirtualClustersRequest, ListVirtualClustersResponse, StartJobRunRequest, VirtualCluster,
};
use aws_sdk_emrcontainers::types::{
    CloudWatchMonitoringConfiguration, Configuration, ConfigurationOverrides, ContainerInfo,
    JobDriver, MonitoringConfiguration, S3MonitoringConfiguration, SparkSubmitJobDriver,
};
use chrono::Utc;
use tauri::AppHandle;

const MAX_CONFIGURATION_DEPTH: usize = 32;
const EMR_JOB_NAME_MESSAGE: &str =
    "Job name can only contain letters, numbers, dot, hyphen, underscore, slash, or #. Replace spaces with hyphens or underscores.";

#[tauri::command]
pub async fn list_virtual_clusters(
    app: AppHandle,
    request: ListVirtualClustersRequest,
) -> AppResult<ListVirtualClustersResponse> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    let mut operation = client.list_virtual_clusters();
    if let Some(next_token) = request.next_token {
        operation = operation.next_token(next_token);
    }
    if let Some(max_results) = request.max_results {
        operation = operation.max_results(max_results);
    }

    let response = operation.send().await.map_err(|error| {
        AppError::aws_for_account_sdk("emr-containers", runtime.account.id.clone(), error)
    })?;

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
pub async fn list_job_runs(
    app: AppHandle,
    _request: JobRunRequest,
) -> AppResult<Vec<JobRunSummary>> {
    let request = _request;
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let pool = repository::pool().await?;
    let keyword = request
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(virtual_cluster_id) = request.virtual_cluster_id else {
        return repository::list_job_history(&pool, Some(&runtime.account.id), None, keyword).await;
    };
    if keyword.is_some() {
        return repository::list_job_history(
            &pool,
            Some(&runtime.account.id),
            Some(&virtual_cluster_id),
            keyword,
        )
        .await;
    }

    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    let mut operation = client
        .list_job_runs()
        .virtual_cluster_id(&virtual_cluster_id);
    if let Some(next_token) = request.next_token {
        operation = operation.next_token(next_token);
    }
    if let Some(max_results) = request.max_results {
        operation = operation.max_results(max_results);
    }

    let response = operation.send().await.map_err(|error| {
        AppError::aws_for_account_sdk("emr-containers", runtime.account.id.clone(), error)
    })?;
    let jobs: Vec<JobRunSummary> = response
        .job_runs()
        .iter()
        .map(|job| {
            map_job_run(
                job,
                Some(runtime.account.id.clone()),
                Some(runtime.account.region.clone()),
            )
        })
        .collect();
    for job in &jobs {
        repository::upsert_job_history(&pool, job).await?;
    }
    repository::prune_job_history(&pool, Some(&runtime.account.id)).await?;

    repository::list_job_history(&pool, Some(&runtime.account.id), Some(&virtual_cluster_id), None)
        .await
}

#[tauri::command]
pub async fn describe_job_run(app: AppHandle, request: JobRunRequest) -> AppResult<JobRunSummary> {
    let account_id = request.account_id.clone();
    let id = request
        .id
        .ok_or_else(|| AppError::validation("Job id is required."))?;
    let runtime = runtime_for_context(&app, AwsCommandContext { account_id }).await?;

    let pool = repository::pool().await?;
    let Some(virtual_cluster_id) = request.virtual_cluster_id else {
        return repository::list_job_history(&pool, Some(&runtime.account.id), None, None)
            .await?
            .into_iter()
            .find(|job| job.id == id)
            .ok_or_else(|| {
                AppError::validation(format!("Job {id} was not found in local history."))
            });
    };

    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    let response = client
        .describe_job_run()
        .id(&id)
        .virtual_cluster_id(&virtual_cluster_id)
        .send()
        .await
        .map_err(|error| {
            AppError::aws_for_account_sdk("emr-containers", runtime.account.id.clone(), error)
        })?;
    let job_run = response
        .job_run()
        .ok_or_else(|| AppError::validation(format!("Job {id} was not returned by EMR.")))?;
    let account_id = runtime.account.id.clone();
    let region = runtime.account.region.clone();
    let mut job = map_job_run(job_run, Some(account_id.clone()), Some(region));
    if let Some(existing) =
        repository::list_job_history(&pool, Some(&account_id), Some(&virtual_cluster_id), None)
            .await?
            .into_iter()
            .find(|existing| existing.id == id)
    {
        job.source_request = existing.source_request.or(job.source_request);
    }
    repository::upsert_job_history(&pool, &job).await?;
    Ok(job)
}

#[tauri::command]
pub async fn start_job_run(
    app: AppHandle,
    request: StartJobRunRequest,
) -> AppResult<JobRunSummary> {
    validate_start_job_request(&request)?;
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    let job_driver = build_job_driver(&request)?;
    let client_token = uuid::Uuid::new_v4().to_string();
    let virtual_cluster_id = request.virtual_cluster_id.clone();
    let mut operation = client
        .start_job_run()
        .name(request.name.clone())
        .virtual_cluster_id(request.virtual_cluster_id.clone())
        .client_token(client_token)
        .execution_role_arn(request.execution_role_arn.clone())
        .release_label(request.release_label.clone())
        .job_driver(job_driver);
    if let Some(overrides) =
        build_configuration_overrides(request.configuration_overrides.as_ref())?
    {
        operation = operation.configuration_overrides(overrides);
    }
    let response = operation.send().await.map_err(|error| {
        AppError::aws_for_account_sdk("emr-containers", runtime.account.id.clone(), error)
    })?;
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
        virtual_cluster_id: response
            .virtual_cluster_id()
            .unwrap_or(&virtual_cluster_id)
            .to_string(),
        virtual_cluster_name: None,
        created_at: now.to_rfc3339(),
        started_at: Some(now.to_rfc3339()),
        finished_at: None,
        duration_seconds: None,
        source_request: Some(request),
        describe_details: None,
    };

    let pool = repository::pool().await?;
    repository::upsert_job_history(&pool, &job).await?;

    Ok(job)
}

#[tauri::command]
pub async fn cancel_job_run(app: AppHandle, request: JobRunRequest) -> AppResult<JobRunSummary> {
    let account_id = request.account_id.clone();
    let id = request
        .id
        .ok_or_else(|| AppError::validation("Job id is required."))?;
    let virtual_cluster_id = request
        .virtual_cluster_id
        .ok_or_else(|| AppError::validation("Virtual cluster id is required."))?;
    let runtime = runtime_for_context(&app, AwsCommandContext { account_id }).await?;
    let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
    client
        .cancel_job_run()
        .id(&id)
        .virtual_cluster_id(&virtual_cluster_id)
        .send()
        .await
        .map_err(|error| {
            AppError::aws_for_account_sdk("emr-containers", runtime.account.id.clone(), error)
        })?;

    let pool = repository::pool().await?;
    let mut job =
        repository::list_job_history(&pool, Some(&runtime.account.id), Some(&virtual_cluster_id), None)
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
                describe_details: None,
            });
    job.state = "CANCELLED".to_string();
    job.finished_at = Some(Utc::now().to_rfc3339());
    job.duration_seconds = duration_seconds(
        job.started_at.as_deref().unwrap_or(&job.created_at),
        job.finished_at.as_deref(),
    );
    repository::upsert_job_history(&pool, &job).await?;

    Ok(job)
}

fn build_job_driver(request: &StartJobRunRequest) -> AppResult<JobDriver> {
    let spark_driver = SparkSubmitJobDriver::builder()
        .entry_point(
            request
                .job_driver
                .spark_submit_job_driver
                .entry_point
                .clone(),
        )
        .set_entry_point_arguments(Some(
            request
                .job_driver
                .spark_submit_job_driver
                .entry_point_arguments
                .clone(),
        ))
        .spark_submit_parameters(
            request
                .job_driver
                .spark_submit_job_driver
                .spark_submit_parameters
                .clone(),
        )
        .build()
        .map_err(|error| AppError::validation(error.to_string()))?;

    Ok(JobDriver::builder()
        .spark_submit_job_driver(spark_driver)
        .build())
}

fn validate_start_job_request(request: &StartJobRunRequest) -> AppResult<()> {
    if request.name.trim().is_empty() {
        return Err(AppError::validation("Job name is required."));
    }
    if request.name.len() > 64 {
        return Err(AppError::validation(
            "Job name must be 64 characters or fewer.",
        ));
    }
    if !is_valid_emr_job_name(&request.name) {
        return Err(AppError::validation(EMR_JOB_NAME_MESSAGE));
    }
    let entry_point = request
        .job_driver
        .spark_submit_job_driver
        .entry_point
        .trim()
        .to_string();
    let jar_path = if entry_point.is_empty() {
        request.application.jar_path.clone()
    } else {
        entry_point
    };
    if request.application.r#type != "jar" {
        return Err(AppError::validation("Only Jar applications are supported."));
    }
    if !jar_path.starts_with("s3://") {
        return Err(AppError::validation("Jar Path must be an S3 URI."));
    }
    if request.execution_role_arn.trim().is_empty() {
        return Err(AppError::validation("Execution role ARN is required."));
    }
    Ok(())
}

fn is_valid_emr_job_name(name: &str) -> bool {
    name.chars().all(|value| {
        value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_' | '/' | '#')
    })
}

fn build_configuration_overrides(
    value: Option<&serde_json::Value>,
) -> AppResult<Option<ConfigurationOverrides>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let application_configuration = value
        .get("applicationConfiguration")
        .and_then(|items| items.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|value| build_configuration(value, 1))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let monitoring_configuration = value
        .get("monitoringConfiguration")
        .and_then(build_monitoring_configuration);

    if application_configuration.is_empty() && monitoring_configuration.is_none() {
        return Ok(None);
    }

    let mut builder = ConfigurationOverrides::builder();
    if !application_configuration.is_empty() {
        builder = builder.set_application_configuration(Some(application_configuration));
    }
    if let Some(monitoring) = monitoring_configuration {
        builder = builder.monitoring_configuration(monitoring);
    }

    Ok(Some(builder.build()))
}

fn build_configuration(value: &serde_json::Value, depth: usize) -> Option<Configuration> {
    let classification = value.get("classification")?.as_str()?.to_string();
    let mut builder = Configuration::builder().classification(classification);
    if let Some(properties) = value.get("properties").and_then(|props| props.as_object()) {
        for (key, property_value) in properties {
            if let Some(property) = property_value.as_str() {
                builder = builder.properties(key, property);
            }
        }
    }
    if depth < MAX_CONFIGURATION_DEPTH {
        if let Some(configurations) = value
            .get("configurations")
            .and_then(|items| items.as_array())
        {
            let nested = configurations
                .iter()
                .filter_map(|value| build_configuration(value, depth + 1))
                .collect::<Vec<_>>();
            if !nested.is_empty() {
                builder = builder.set_configurations(Some(nested));
            }
        }
    }
    builder.build().ok()
}

fn build_monitoring_configuration(value: &serde_json::Value) -> Option<MonitoringConfiguration> {
    let mut builder = MonitoringConfiguration::builder();
    let mut has_config = false;
    if let Some(cloud_watch) = value
        .get("cloudWatchMonitoringConfiguration")
        .and_then(|config| {
            let log_group = config.get("logGroupName")?.as_str()?;
            let mut cloud_watch_builder =
                CloudWatchMonitoringConfiguration::builder().log_group_name(log_group);
            if let Some(prefix) = config
                .get("logStreamNamePrefix")
                .and_then(|prefix| prefix.as_str())
            {
                cloud_watch_builder = cloud_watch_builder.log_stream_name_prefix(prefix);
            }
            cloud_watch_builder.build().ok()
        })
    {
        builder = builder.cloud_watch_monitoring_configuration(cloud_watch);
        has_config = true;
    }
    if let Some(s3) = value.get("s3MonitoringConfiguration").and_then(|config| {
        let log_uri = config.get("logUri")?.as_str()?;
        S3MonitoringConfiguration::builder()
            .log_uri(log_uri)
            .build()
            .ok()
    }) {
        builder = builder.s3_monitoring_configuration(s3);
        has_config = true;
    }
    if !has_config {
        return None;
    }
    Some(builder.build())
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
    let created_at = job
        .created_at()
        .map(|created_at| created_at.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let finished_at = job.finished_at().map(|finished_at| finished_at.to_string());

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
        created_at: created_at.clone(),
        started_at: None,
        finished_at: finished_at.clone(),
        duration_seconds: duration_seconds(&created_at, finished_at.as_deref()),
        source_request: None,
        describe_details: Some(map_describe_details(job)),
    }
}

fn map_describe_details(job: &aws_sdk_emrcontainers::types::JobRun) -> JobRunDescribeDetails {
    JobRunDescribeDetails {
        arn: job.arn().map(ToString::to_string),
        client_token: job.client_token().map(ToString::to_string),
        execution_role_arn: job.execution_role_arn().map(ToString::to_string),
        release_label: job.release_label().map(ToString::to_string),
        created_by: job.created_by().map(ToString::to_string),
        state_details: job.state_details().map(ToString::to_string),
        failure_reason: job
            .failure_reason()
            .map(|reason| reason.as_str().to_string()),
        tags: job.tags().cloned(),
        retry_max_attempts: job
            .retry_policy_configuration()
            .map(|config| config.max_attempts()),
        retry_current_attempt_count: job
            .retry_policy_execution()
            .map(|execution| execution.current_attempt_count()),
        job_driver: job.job_driver().and_then(map_job_driver),
        configuration_overrides: job
            .configuration_overrides()
            .and_then(map_configuration_overrides),
    }
}

fn map_configuration_overrides(
    overrides: &aws_sdk_emrcontainers::types::ConfigurationOverrides,
) -> Option<serde_json::Value> {
    let application_configuration = overrides
        .application_configuration()
        .iter()
        .map(map_configuration)
        .collect::<Vec<_>>();
    let monitoring_configuration = overrides
        .monitoring_configuration()
        .map(map_monitoring_configuration);

    if application_configuration.is_empty() && monitoring_configuration.is_none() {
        return None;
    }

    Some(serde_json::json!({
        "applicationConfiguration": application_configuration,
        "monitoringConfiguration": monitoring_configuration,
    }))
}

fn map_monitoring_configuration(
    monitoring: &aws_sdk_emrcontainers::types::MonitoringConfiguration,
) -> serde_json::Value {
    serde_json::json!({
        "persistentAppUi": monitoring.persistent_app_ui().map(|value| format!("{value:?}")),
        "cloudWatchMonitoringConfiguration": monitoring
            .cloud_watch_monitoring_configuration()
            .map(|cloud_watch| {
                serde_json::json!({
                    "logGroupName": cloud_watch.log_group_name(),
                    "logStreamNamePrefix": cloud_watch.log_stream_name_prefix(),
                })
            }),
        "s3MonitoringConfiguration": monitoring
            .s3_monitoring_configuration()
            .map(|s3| {
                serde_json::json!({
                    "logUri": s3.log_uri(),
                })
            }),
    })
}

fn map_configuration(config: &aws_sdk_emrcontainers::types::Configuration) -> serde_json::Value {
    map_configuration_with_depth(config, 1)
}

fn map_configuration_with_depth(
    config: &aws_sdk_emrcontainers::types::Configuration,
    depth: usize,
) -> serde_json::Value {
    let configurations = if depth < MAX_CONFIGURATION_DEPTH {
        config
            .configurations()
            .iter()
            .map(|config| map_configuration_with_depth(config, depth + 1))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    serde_json::json!({
        "classification": config.classification(),
        "properties": config.properties(),
        "configurations": configurations,
    })
}

fn map_job_driver(
    job_driver: &aws_sdk_emrcontainers::types::JobDriver,
) -> Option<serde_json::Value> {
    if let Some(spark_submit) = job_driver.spark_submit_job_driver() {
        return Some(serde_json::json!({
            "type": "sparkSubmit",
            "entryPoint": spark_submit.entry_point(),
            "entryPointArguments": spark_submit.entry_point_arguments(),
            "sparkSubmitParameters": spark_submit.spark_submit_parameters(),
        }));
    }

    if let Some(spark_sql) = job_driver.spark_sql_job_driver() {
        return Some(serde_json::json!({
            "type": "sparkSql",
            "entryPoint": spark_sql.entry_point(),
            "sparkSqlParameters": spark_sql.spark_sql_parameters(),
        }));
    }

    None
}

fn duration_seconds(started_at: &str, finished_at: Option<&str>) -> Option<i64> {
    let finished_at = finished_at?;
    let start = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
    let end = chrono::DateTime::parse_from_rfc3339(finished_at).ok()?;
    Some((end - start).num_seconds().max(0))
}

#[cfg(test)]
mod tests {
    use super::{map_job_run, validate_start_job_request};
    use crate::models::{
        JarApplicationConfig, JobDriverRequest, SparkResourceConfig, SparkSubmitJobDriverRequest,
        StartJobRunRequest,
    };
    use aws_sdk_emrcontainers::types::{
        CloudWatchMonitoringConfiguration, ConfigurationOverrides, JobRun, JobRunState,
        MonitoringConfiguration, RetryPolicyConfiguration, RetryPolicyExecution,
        S3MonitoringConfiguration, SparkSubmitJobDriver,
    };

    #[test]
    fn maps_describe_job_run_details_without_dropping_remote_fields() {
        let job_driver = aws_sdk_emrcontainers::types::JobDriver::builder()
            .spark_submit_job_driver(
                SparkSubmitJobDriver::builder()
                    .entry_point("s3://bucket/app.jar")
                    .entry_point_arguments("--date")
                    .entry_point_arguments("2026-06-10")
                    .spark_submit_parameters("--class Main")
                    .build()
                    .expect("spark driver builds"),
            )
            .build();
        let job = JobRun::builder()
            .id("job-running")
            .name("running-etl")
            .virtual_cluster_id("vc-1")
            .arn("arn:aws:emr-containers:us-east-1:123456789012:/virtualclusters/vc-1/jobruns/job-running")
            .state(JobRunState::Running)
            .client_token("client-token")
            .execution_role_arn("arn:aws:iam::123456789012:role/EMR")
            .release_label("emr-7.2.0-latest")
            .job_driver(job_driver)
            .created_by("tester")
            .state_details("Job is running")
            .tags("owner", "analytics")
            .retry_policy_configuration(
                RetryPolicyConfiguration::builder()
                    .max_attempts(3)
                    .build()
                    .expect("retry config builds"),
            )
            .retry_policy_execution(
                RetryPolicyExecution::builder()
                    .current_attempt_count(1)
                    .build()
                    .expect("retry execution builds"),
            )
            .build();

        let summary = map_job_run(
            &job,
            Some("account".to_string()),
            Some("us-east-1".to_string()),
        );
        let details = summary.describe_details.expect("describe details exist");

        assert_eq!(details.release_label.as_deref(), Some("emr-7.2.0-latest"));
        assert_eq!(
            details.execution_role_arn.as_deref(),
            Some("arn:aws:iam::123456789012:role/EMR")
        );
        assert_eq!(details.state_details.as_deref(), Some("Job is running"));
        assert_eq!(details.retry_max_attempts, Some(3));
        assert_eq!(details.retry_current_attempt_count, Some(1));
        assert_eq!(
            details
                .tags
                .as_ref()
                .and_then(|values| values.get("owner"))
                .map(String::as_str),
            Some("analytics")
        );
        assert_eq!(
            details
                .job_driver
                .as_ref()
                .and_then(|value| value.get("entryPoint"))
                .and_then(|value| value.as_str()),
            Some("s3://bucket/app.jar")
        );
    }

    #[test]
    fn maps_structured_monitoring_configuration() {
        let overrides = ConfigurationOverrides::builder()
            .monitoring_configuration(
                MonitoringConfiguration::builder()
                    .cloud_watch_monitoring_configuration(
                        CloudWatchMonitoringConfiguration::builder()
                            .log_group_name("/aws/emr-containers/jobs/custom")
                            .log_stream_name_prefix("custom-prefix")
                            .build()
                            .expect("cloudwatch config builds"),
                    )
                    .s3_monitoring_configuration(
                        S3MonitoringConfiguration::builder()
                            .log_uri("s3://logs-bucket/emr/")
                            .build()
                            .expect("s3 config builds"),
                    )
                    .build(),
            )
            .build();

        let monitoring = super::map_configuration_overrides(&overrides)
            .and_then(|value| value.get("monitoringConfiguration").cloned())
            .expect("monitoring configuration exists");
        let cloud_watch = monitoring
            .get("cloudWatchMonitoringConfiguration")
            .expect("cloudwatch config exists");
        let s3 = monitoring
            .get("s3MonitoringConfiguration")
            .expect("s3 config exists");

        assert_eq!(
            cloud_watch
                .get("logGroupName")
                .and_then(|value| value.as_str()),
            Some("/aws/emr-containers/jobs/custom")
        );
        assert_eq!(
            cloud_watch
                .get("logStreamNamePrefix")
                .and_then(|value| value.as_str()),
            Some("custom-prefix")
        );
        assert_eq!(
            s3.get("logUri").and_then(|value| value.as_str()),
            Some("s3://logs-bucket/emr/")
        );
    }

    #[test]
    fn builds_configuration_overrides_for_submit() {
        let overrides = serde_json::json!({
            "applicationConfiguration": [{
                "classification": "spark-defaults",
                "properties": {
                    "spark.driver.cores": "2",
                    "spark.executor.instances": "3"
                }
            }],
            "monitoringConfiguration": {
                "cloudWatchMonitoringConfiguration": {
                    "logGroupName": "/aws/emr-containers/jobs",
                    "logStreamNamePrefix": "tester"
                }
            }
        });

        let built =
            super::build_configuration_overrides(Some(&overrides)).expect("overrides build");
        let mapped = super::map_configuration_overrides(&built.expect("built overrides"))
            .expect("overrides map back");
        let app_config = mapped
            .get("applicationConfiguration")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .expect("application configuration exists");

        assert_eq!(
            app_config
                .get("properties")
                .and_then(|props| props.get("spark.driver.cores"))
                .and_then(|value| value.as_str()),
            Some("2")
        );
    }

    #[test]
    fn rejects_job_names_that_emr_start_job_run_will_reject() {
        let mut request = valid_start_job_request();
        request.name = "bigdata etl-jinghui".to_string();

        let error = validate_start_job_request(&request).expect_err("job name is invalid");

        assert_eq!(
            error.message,
            "Job name can only contain letters, numbers, dot, hyphen, underscore, slash, or #. Replace spaces with hyphens or underscores."
        );
    }

    #[test]
    fn limits_deep_configuration_override_nesting() {
        let input = nested_configuration_json(80);
        let overrides = serde_json::json!({
            "applicationConfiguration": [input]
        });

        let built =
            super::build_configuration_overrides(Some(&overrides)).expect("overrides build");
        let mapped = super::map_configuration_overrides(&built.expect("built overrides"))
            .expect("overrides map back");
        let first_config = mapped
            .get("applicationConfiguration")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .expect("first configuration exists");

        assert_eq!(configuration_depth(first_config), 32);
    }

    fn nested_configuration_json(depth: usize) -> serde_json::Value {
        let mut value = serde_json::json!({
            "classification": format!("level-{depth}")
        });
        for level in (0..depth).rev() {
            value = serde_json::json!({
                "classification": format!("level-{level}"),
                "configurations": [value]
            });
        }
        value
    }

    fn configuration_depth(value: &serde_json::Value) -> usize {
        let nested = value
            .get("configurations")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first());

        1 + nested.map(configuration_depth).unwrap_or(0)
    }

    fn valid_start_job_request() -> StartJobRunRequest {
        StartJobRunRequest {
            account_id: None,
            name: "bigdata-etl-jinghui".to_string(),
            virtual_cluster_id: "li36cjq5163l1bh8ms7d6kr04".to_string(),
            execution_role_arn: "arn:aws:iam::123456789012:role/EMR".to_string(),
            release_label: "emr-7.2.0-latest".to_string(),
            application: JarApplicationConfig {
                r#type: "jar".to_string(),
                jar_path: "s3://bucket/app.jar".to_string(),
                main_class: "com.example.Main".to_string(),
            },
            arguments: Vec::new(),
            resources: SparkResourceConfig {
                driver_cores: 1,
                driver_memory: "1G".to_string(),
                executor_cores: 1,
                executor_memory: "1G".to_string(),
                executor_instances: 1,
            },
            spark_config: Default::default(),
            job_driver: JobDriverRequest {
                spark_submit_job_driver: SparkSubmitJobDriverRequest {
                    entry_point: "s3://bucket/app.jar".to_string(),
                    entry_point_arguments: Vec::new(),
                    spark_submit_parameters: "--class com.example.Main".to_string(),
                },
            },
            configuration_overrides: None,
        }
    }
}
