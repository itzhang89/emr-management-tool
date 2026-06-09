use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsCredentialsInput {
    pub access_key_id: String,
    pub secret_access_key: String,
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
pub struct JobRunSummary {
    pub id: String,
    pub name: String,
    pub state: String,
    pub virtual_cluster_id: String,
    pub virtual_cluster_name: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRunRequest {
    pub id: Option<String>,
    pub virtual_cluster_id: Option<String>,
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
pub struct JobLogsRequest {
    pub job_id: String,
    pub next_forward_token: Option<String>,
    pub log_group_name: Option<String>,
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
    pub bucket: String,
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ObjectRequest {
    pub bucket: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3TextObject {
    pub bucket: String,
    pub key: String,
    pub content: String,
    pub etag: Option<String>,
    pub content_type: Option<String>,
    pub last_modified: Option<String>,
}
