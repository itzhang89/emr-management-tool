use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsCredentialsInput {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub region: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsIdentity {
    pub account: String,
    pub arn: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsSettings {
    pub region: String,
    pub has_saved_credentials: bool,
    pub identity: Option<AwsIdentity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsAccount {
    pub id: String,
    pub name: String,
    pub region: String,
    pub access_key_id_masked: String,
    pub identity: Option<AwsIdentity>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsAccountSummary {
    pub id: String,
    pub name: String,
    pub region: String,
    pub access_key_id_masked: String,
    pub identity: Option<AwsIdentity>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAccount {
    pub account: Option<AwsAccountSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsCommandContext {
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsAccountCredentialsInput {
    pub id: Option<String>,
    pub name: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub region: String,
    pub make_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsCliProfileSummary {
    pub profile_name: String,
    pub region: Option<String>,
    pub access_key_id_masked: Option<String>,
    pub can_import: bool,
    pub import_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAwsCliProfileRequest {
    pub profile_name: String,
    pub name: Option<String>,
    pub make_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionRequest {
    pub region: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualCluster {
    pub id: String,
    pub name: String,
    pub state: String,
    pub namespace: String,
    pub eks_cluster_name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListVirtualClustersRequest {
    pub account_id: Option<String>,
    pub next_token: Option<String>,
    pub max_results: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListVirtualClustersResponse {
    pub clusters: Vec<VirtualCluster>,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRunDescribeDetails {
    pub arn: Option<String>,
    pub client_token: Option<String>,
    pub execution_role_arn: Option<String>,
    pub release_label: Option<String>,
    pub created_by: Option<String>,
    pub state_details: Option<String>,
    pub failure_reason: Option<String>,
    pub tags: Option<HashMap<String, String>>,
    pub retry_max_attempts: Option<i32>,
    pub retry_current_attempt_count: Option<i32>,
    pub job_driver: Option<serde_json::Value>,
    pub configuration_overrides: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRunSummary {
    pub id: String,
    pub name: String,
    pub state: String,
    pub account_id: Option<String>,
    pub region: Option<String>,
    pub virtual_cluster_id: String,
    pub virtual_cluster_name: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_seconds: Option<i64>,
    pub source_request: Option<StartJobRunRequest>,
    pub describe_details: Option<JobRunDescribeDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRunRequest {
    pub account_id: Option<String>,
    pub id: Option<String>,
    pub virtual_cluster_id: Option<String>,
    pub next_token: Option<String>,
    pub max_results: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparkResourceConfig {
    pub driver_cores: i32,
    pub driver_memory: String,
    pub executor_cores: i32,
    pub executor_memory: String,
    pub executor_instances: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JarApplicationConfig {
    pub r#type: String,
    pub jar_path: String,
    pub main_class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparkSubmitJobDriverRequest {
    pub entry_point: String,
    pub entry_point_arguments: Vec<String>,
    pub spark_submit_parameters: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobDriverRequest {
    pub spark_submit_job_driver: SparkSubmitJobDriverRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartJobRunRequest {
    pub account_id: Option<String>,
    pub name: String,
    pub virtual_cluster_id: String,
    pub execution_role_arn: String,
    pub release_label: String,
    pub application: JarApplicationConfig,
    pub arguments: Vec<String>,
    pub resources: SparkResourceConfig,
    pub spark_config: HashMap<String, String>,
    pub job_driver: JobDriverRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub jar_path: String,
    pub main_class: String,
    pub default_arguments: Vec<String>,
    pub spark_config: HashMap<String, String>,
    pub resource_template_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceTemplate {
    pub id: String,
    pub name: String,
    pub resources: SparkResourceConfig,
    pub built_in: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatesResponse {
    pub application_templates: Vec<ApplicationTemplate>,
    pub resource_templates: Vec<ResourceTemplate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateMutationRequest {
    pub id: String,
    pub r#type: String,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    pub stream_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLogStream {
    pub source: String,
    pub id: String,
    pub label: String,
    pub r#type: String,
    pub container: String,
    pub pod: String,
    pub stream: String,
    pub cloud_watch_stream_name: String,
    pub last_event_timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLogStreamsRequest {
    pub account_id: Option<String>,
    pub job_id: String,
    pub log_group_name: String,
    pub stream_name_prefix: String,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLogStreamsResponse {
    pub job_id: String,
    pub streams: Vec<JobLogStream>,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLogsRequest {
    pub account_id: Option<String>,
    pub job_id: String,
    pub next_forward_token: Option<String>,
    pub log_group_name: Option<String>,
    pub stream_name_prefix: Option<String>,
    pub log_stream_name: Option<String>,
    pub log_type: Option<String>,
    pub filter_pattern: Option<String>,
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLogsResponse {
    pub job_id: String,
    pub entries: Vec<LogEntry>,
    pub next_forward_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Bucket {
    pub name: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ObjectEntry {
    pub bucket: String,
    pub key: String,
    pub kind: String,
    pub size: i64,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ListObjectsRequest {
    pub account_id: Option<String>,
    pub bucket: String,
    pub prefix: Option<String>,
    pub continuation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ObjectRequest {
    pub account_id: Option<String>,
    pub bucket: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3TextObject {
    pub account_id: Option<String>,
    pub bucket: String,
    pub key: String,
    pub content: String,
    pub etag: Option<String>,
    pub content_type: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3JobLogObject {
    pub source: String,
    pub id: String,
    pub label: String,
    pub r#type: String,
    pub container: String,
    pub pod: String,
    pub stream: String,
    pub s3_key: String,
    pub size: i64,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3JobLogObjectsRequest {
    pub account_id: Option<String>,
    pub bucket: String,
    pub prefix: String,
    pub continuation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3JobLogObjectsResponse {
    pub bucket: String,
    pub objects: Vec<S3JobLogObject>,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTextFileRequest {
    pub suggested_name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3UploadFromDiskRequest {
    pub account_id: Option<String>,
    pub bucket: String,
    pub prefix: Option<String>,
}
