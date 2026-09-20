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

/// One tag on an AWS Secrets Manager secret (metadata only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretTag {
    pub key: String,
    pub value: String,
}

/// List/describe projection — never includes SecretString.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretSummary {
    pub name: String,
    pub arn: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<SecretTag>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_changed_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretIdRequest {
    /// Secret name or ARN.
    pub secret_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSecretInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub secret_string: String,
    #[serde(default)]
    pub tags: Vec<SecretTag>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSecretInput {
    pub secret_id: String,
    pub secret_string: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSecretInput {
    pub secret_id: String,
    /// Recovery window in days (7–30). Defaults to 7 when absent.
    #[serde(default)]
    pub recovery_window_in_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSecretResult {
    pub name: String,
    pub arn: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletion_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretValueResponse {
    pub value: String,
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
pub struct AwsAccountUpdateInput {
    pub account_id: String,
    pub name: String,
    pub region: String,
    #[serde(default)]
    pub secret_access_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAwsAccountRequest {
    pub account_id: String,
    pub region: String,
    #[serde(default)]
    pub secret_access_key: Option<String>,
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
    pub region: Option<String>,
    pub make_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsCliProfileCredentials {
    pub profile_name: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub region: Option<String>,
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
    pub keyword: Option<String>,
    pub next_token: Option<String>,
    pub max_results: Option<i32>,
    /// AWS ListJobRuns createdAfter window in days. Defaults to 7 when omitted.
    pub created_after_days: Option<i32>,
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
    pub configuration_overrides: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVariableDefinition {
    pub name: String,
    pub label: Option<String>,
    pub description: Option<String>,
    pub r#type: String,
    pub default_value: Option<serde_json::Value>,
    pub options: Option<Vec<String>>,
    pub format: Option<String>,
    pub required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobConfigTemplate {
    pub id: String,
    pub account_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub payload_template: String,
    pub custom_variables: Vec<TemplateVariableDefinition>,
    pub default_resource_template_id: Option<String>,
    pub built_in: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobConfigTemplatesResponse {
    pub job_config_templates: Vec<JobConfigTemplate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobConfigTemplateMutationRequest {
    pub id: String,
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
    pub region: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3UploadPrepareResult {
    pub local_path: String,
    pub file_name: String,
    pub key: String,
    pub bucket: String,
    pub total_bytes: u64,
    pub exists: bool,
    pub suggested_file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3UploadFromPathRequest {
    pub account_id: Option<String>,
    pub bucket: String,
    pub key: String,
    pub local_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ObjectExistsRequest {
    pub account_id: Option<String>,
    pub bucket: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3RenameObjectRequest {
    pub account_id: Option<String>,
    pub bucket: String,
    pub source_key: String,
    pub destination_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3CreateFolderRequest {
    pub account_id: Option<String>,
    pub bucket: String,
    pub parent_prefix: Option<String>,
    pub folder_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3PrefixDeletionSummary {
    pub prefix: String,
    pub file_count: u64,
    pub folder_count: u64,
    pub total_object_count: u64,
    pub total_bytes: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueListRequest {
    pub account_id: Option<String>,
    pub catalog_id: Option<String>,
    pub database_name: Option<String>,
    pub next_token: Option<String>,
    pub max_results: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueDatabase {
    pub name: String,
    pub description: Option<String>,
    pub location_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueDatabaseDetail {
    pub name: String,
    pub catalog_id: String,
    pub description: Option<String>,
    pub location_uri: Option<String>,
    pub create_time: Option<String>,
    pub parameters: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueGetDatabaseRequest {
    pub account_id: Option<String>,
    pub catalog_id: Option<String>,
    pub database_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueUpdateDatabaseRequest {
    pub account_id: Option<String>,
    pub catalog_id: Option<String>,
    pub database: GlueDatabaseDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueListDatabasesResponse {
    pub databases: Vec<GlueDatabase>,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueTableSummary {
    pub name: String,
    pub database_name: String,
    pub table_type: Option<String>,
    pub create_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueListTablesResponse {
    pub tables: Vec<GlueTableSummary>,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueColumn {
    pub name: String,
    pub r#type: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueTableDetail {
    pub name: String,
    pub database_name: String,
    pub catalog_id: String,
    pub description: Option<String>,
    pub table_type: Option<String>,
    pub owner: Option<String>,
    pub create_time: Option<String>,
    pub update_time: Option<String>,
    pub parameters: HashMap<String, String>,
    pub columns: Vec<GlueColumn>,
    pub partition_keys: Vec<GlueColumn>,
    pub location: Option<String>,
    pub input_format: Option<String>,
    pub output_format: Option<String>,
    pub serde_library: Option<String>,
    pub serde_parameters: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueGetTableRequest {
    pub account_id: Option<String>,
    pub catalog_id: Option<String>,
    pub database_name: String,
    pub table_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueUpdateTableRequest {
    pub account_id: Option<String>,
    pub catalog_id: Option<String>,
    pub table: GlueTableDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthenaWorkgroup {
    pub name: String,
    pub description: Option<String>,
    pub state: Option<String>,
    pub managed_results_enabled: bool,
    pub enforce_configuration: bool,
    pub output_location: Option<String>,
    pub spark_enabled: bool,
    pub effective_engine_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAthenaQueryRequest {
    pub account_id: Option<String>,
    pub sql: String,
    pub database: Option<String>,
    pub workgroup: String,
    pub output_location: Option<String>,
    pub catalog: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthenaQueryExecutionRequest {
    pub account_id: Option<String>,
    pub query_execution_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthenaQueryExecution {
    pub query_execution_id: String,
    pub state: String,
    pub state_change_reason: Option<String>,
    pub submission_date_time: Option<String>,
    pub completion_date_time: Option<String>,
    pub data_scanned_bytes: Option<i64>,
    pub engine_execution_time_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthenaQueryResultsRequest {
    pub account_id: Option<String>,
    pub query_execution_id: String,
    pub next_token: Option<String>,
    pub max_results: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthenaQueryResults {
    pub column_names: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub next_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAthenaQueryCsvRequest {
    pub account_id: Option<String>,
    pub query_execution_id: String,
    pub suggested_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStartRequest {
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub mcp_port: Option<u16>,
    pub endpoint_url: Option<String>,
}

/// One advertised MCP tool, for the MCP Server panel. DBHub tools are the
/// per-connection `execute_sql_<slug>` entries for the active account.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    /// Currently advertised tools are always callable; kept explicit for the UI.
    pub enabled: bool,
    /// Placeholder until per-tool confirmation exists. `"default_allow"` means
    /// the call runs without a user prompt today.
    pub auto_approve: String,
    pub is_dbhub: bool,
    /// `emr` | `dbhub` | `glue` | `runbook`
    pub category: String,
}

/// One MCP tool invocation, persisted into the app's SQLite database
/// (`mcp_audit` table) and shown in the Audit Log tab.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuditEntry {
    pub id: String,
    pub timestamp: String,
    /// "success" | "error"
    pub status: String,
    pub tool: String,
    pub client: Option<String>,
    pub duration_ms: i64,
    pub args: serde_json::Value,
    pub result: serde_json::Value,
    pub error: Option<String>,
    /// Which provider drove the call — only in-process Chat calls know this.
    /// External HTTP-agent rows have no provider/model, since the transport
    /// carries no identity.
    pub provider_id: Option<String>,
    /// The API model id (e.g. "claude-opus-4-8") used for the Chat call.
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuditQuery {
    pub limit: Option<usize>,
}

// --- LLM provider configuration -------------------------------------------
// Two levels: provider → model. A provider is one place to send requests —
// protocol, address, API keys, custom headers — and its models hang directly off
// it. There is no endpoint level: a second address means a second provider, and
// the "duplicate" action makes that cheap.
//
// Secrets (API key values and custom header values) never enter SQLite or the
// WebView: they go to the OS keychain via `secrets`, and the frontend only ever
// sees masked values it can replace but not read.

/// Which request/response shape a provider speaks. Not a vendor name: an
/// OpenAI-compatible gateway is `Openai` regardless of who runs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmProtocol {
    Openai,
    Anthropic,
    Gemini,
}

impl LlmProtocol {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "openai" => Some(Self::Openai),
            "anthropic" => Some(Self::Anthropic),
            "gemini" => Some(Self::Gemini),
            _ => None,
        }
    }

    /// Suggested base URL for a brand-new provider. Editable, so
    /// OpenAI-compatible gateways and self-hosted addresses work too.
    ///
    /// Gemini's includes `/v1beta` so that `{base}/models` is the listing path
    /// for all three shapes and only the response parsing differs.
    pub fn default_base_url(self) -> &'static str {
        match self {
            Self::Openai => "https://api.openai.com/v1",
            Self::Anthropic => "https://api.anthropic.com/v1",
            Self::Gemini => "https://generativelanguage.googleapis.com/v1beta",
        }
    }

    /// Header names this protocol sets itself. Custom headers may not override
    /// them: silently shadowing the auth header would make "the key is wrong"
    /// impossible to diagnose.
    pub fn reserved_header_names(self) -> &'static [&'static str] {
        match self {
            Self::Openai => &["authorization"],
            Self::Anthropic => &["x-api-key", "anthropic-version"],
            Self::Gemini => &["x-goog-api-key"],
        }
    }
}

/// What a model can do. Stored as one JSON column rather than seven boolean
/// ones: it is written as a unit by the edit dialog, and adding a modality
/// later should not be a schema change.
///
/// These flags are recorded and displayed but do **not** shape outgoing
/// requests yet — the values come from user input or a gateway's guess, and
/// using them to trim a request would turn one mis-set checkbox into "the model
/// suddenly cannot call tools".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmModelCapabilities {
    pub reasoning: bool,
    pub tool_calling: bool,
    pub text: bool,
    pub vision: bool,
    pub audio: bool,
    pub video: bool,
}

impl LlmModelCapabilities {
    /// What a freshly added chat model is assumed to do. Text is table stakes,
    /// and a model that cannot call tools is the exception rather than the rule
    /// for the gateways this app talks to.
    pub fn chat_defaults() -> Self {
        Self {
            reasoning: false,
            tool_calling: true,
            text: true,
            vision: false,
            audio: false,
            video: false,
        }
    }
}

/// Only `Chat` has behaviour today. The other two are storable so a synced
/// catalogue can be labelled honestly, but they are kept out of Chat's model
/// picker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmModelType {
    Chat,
    Image,
    Embed,
}

impl LlmModelType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Image => "image",
            Self::Embed => "embed",
        }
    }

    /// Unknown values read back as `Chat`: a row whose type could not be parsed
    /// is more useful listed than dropped.
    pub fn parse_or_chat(value: &str) -> Self {
        match value {
            "image" => Self::Image,
            "embed" => Self::Embed,
            _ => Self::Chat,
        }
    }
}

/// One model offered by a provider. `model_id` is the value sent to the API;
/// `series` groups models in the UI, where it is labelled "group".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModel {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub series: String,
    pub display_name: Option<String>,
    pub model_type: LlmModelType,
    pub capabilities: LlmModelCapabilities,
    pub is_default: bool,
    pub context_window: Option<i64>,
    pub max_input_tokens: Option<i64>,
    pub max_output_tokens: Option<i64>,
    pub created_at: DateTime<Utc>,
}

/// Whether a stored API key is usable. `Unknown` means nothing has probed it
/// yet — distinct from `Unhealthy`, which means something tried and was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmApiKeyStatus {
    Unknown,
    Healthy,
    Unhealthy,
}

impl LlmApiKeyStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Healthy => "healthy",
            Self::Unhealthy => "unhealthy",
        }
    }

    pub fn parse_or_unknown(value: &str) -> Self {
        match value {
            "healthy" => Self::Healthy,
            "unhealthy" => Self::Unhealthy,
            _ => Self::Unknown,
        }
    }
}

/// One API key of a provider — its metadata only. The value itself lives in the
/// keychain under `llm/key/{id}`; `masked` is what the WebView gets.
///
/// The health status is deliberately in SQLite rather than beside the value: it
/// is not a secret, and rewriting a keychain entry on every probe would be the
/// wrong use of that store.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmApiKey {
    pub id: String,
    pub provider_id: String,
    pub label: Option<String>,
    /// e.g. "sk-••••abcd". Display only — the real key is never returned.
    pub masked: String,
    pub status: LlmApiKeyStatus,
    /// Why a probe failed, when it did.
    pub status_message: Option<String>,
    pub checked_at: Option<DateTime<Utc>>,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
}

/// One place to send requests: a protocol, an address, the keys that open it,
/// and the models it offers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub protocol: LlmProtocol,
    /// Empty until the user fills it in. A provider with no address cannot be
    /// enabled, since enabling means "requests may go here".
    pub base_url: String,
    pub enabled: bool,
    /// True for a seeded preset the user has not replaced. Presets exist to be
    /// filled in or duplicated; the flag only labels them in the UI.
    pub built_in: bool,
    /// Names of the custom request headers configured here. The values are in
    /// the keychain, so only the names cross to the WebView.
    pub header_names: Vec<String>,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub api_keys: Vec<LlmApiKey>,
    pub models: Vec<LlmModel>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLlmProviderRequest {
    pub name: String,
    pub protocol: Option<LlmProtocol>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmProviderRequest {
    pub id: String,
    pub name: Option<String>,
    pub protocol: Option<LlmProtocol>,
    pub base_url: Option<String>,
    pub enabled: Option<bool>,
    pub sort_order: Option<i64>,
}

/// One custom header. `value: None` on a submit means "keep what is stored",
/// so editing one header does not require retyping the others.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmHeaderInput {
    pub name: String,
    pub value: Option<String>,
}

/// The whole header set for a provider, submitted as a unit: names absent from
/// the list are removed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLlmProviderHeadersRequest {
    pub provider_id: String,
    pub headers: Vec<LlmHeaderInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLlmApiKeyRequest {
    pub provider_id: String,
    pub value: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmApiKeyRequest {
    pub id: String,
    pub label: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderTestResult {
    pub ok: bool,
    pub message: String,
    pub latency_ms: i64,
    /// How many models the provider advertised, when it answered at all.
    pub model_count: Option<usize>,
}

/// A model the provider advertises, before the user chooses to import it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelCandidate {
    pub model_id: String,
    pub series: String,
    pub display_name: Option<String>,
    /// Token limits, for the shapes that report them honestly. Gemini does;
    /// the other two do not, and are left `None` rather than guessed at.
    pub context_window: Option<i64>,
    pub max_input_tokens: Option<i64>,
    pub max_output_tokens: Option<i64>,
    /// True when this provider already has the model stored, so the import
    /// dialog can pre-check it and label it as already added.
    pub already_added: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLlmModelsRequest {
    pub provider_id: String,
    pub models: Vec<AddLlmModelInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLlmModelInput {
    pub model_id: String,
    pub series: Option<String>,
    pub display_name: Option<String>,
    pub model_type: Option<LlmModelType>,
    pub capabilities: Option<LlmModelCapabilities>,
    pub context_window: Option<i64>,
    pub max_input_tokens: Option<i64>,
    pub max_output_tokens: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmModelRequest {
    pub id: String,
    pub model_id: Option<String>,
    pub series: Option<String>,
    pub display_name: Option<String>,
    pub model_type: Option<LlmModelType>,
    pub capabilities: Option<LlmModelCapabilities>,
    pub is_default: Option<bool>,
    pub context_window: Option<i64>,
    pub max_input_tokens: Option<i64>,
    pub max_output_tokens: Option<i64>,
}

/// Deletes addressed by row id. A named struct rather than a bare `String`
/// argument so every LLM command takes the same `{ request: … }` envelope the
/// rest of the app's Tauri commands use.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmIdRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderIdRequest {
    pub provider_id: String,
}

// --- Chat -----------------------------------------------------------------
// Two levels: an assistant is a preset (system prompt, default model, which
// tools it may use), and a session is one conversation with that assistant.
// Messages persist so the sidebar's session list survives a restart.

/// A saved preset. `enabled_tools` of `None` means every MCP tool is available;
/// a list restricts the assistant to those names.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAssistant {
    pub id: String,
    pub name: String,
    pub system_prompt: Option<String>,
    /// `llm_models.id`, not the API's model id.
    pub default_model_id: Option<String>,
    pub enabled_tools: Option<Vec<String>>,
    /// Avatar colour token, chosen by the UI.
    pub accent: Option<String>,
    pub sort_order: i64,
    pub built_in: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub assistant_id: String,
    pub title: String,
    /// Overrides the assistant's default model for this conversation.
    pub model_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Denormalised for the sidebar, which lists sessions without their bodies.
    pub message_count: i64,
}

/// What a stored message is.
///
/// `ContextReset` is a real persisted row rather than a deletion: the user keeps
/// a readable history while the next request starts from after the marker, which
/// is what "clear context" means here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    User,
    Assistant,
    Tool,
    ContextReset,
}

impl ChatRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
            Self::ContextReset => "context_reset",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Self::User),
            "assistant" => Some(Self::Assistant),
            "tool" => Some(Self::Tool),
            "context_reset" => Some(Self::ContextReset),
            _ => None,
        }
    }
}

/// One tool invocation made while answering. Persisted with the assistant
/// message that triggered it so the UI can redraw the collapsible steps after a
/// restart, not just while streaming.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCall {
    pub call_id: String,
    pub tool: String,
    pub args: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    /// Opaque provider token that must be echoed back with this call, verbatim.
    ///
    /// Gemini 3 mints one on the *first* function call of each step and rejects
    /// the follow-up request if it does not come back — so it is persisted rather
    /// than kept only for the round in flight. `None` for the other protocols,
    /// and for parallel calls after the first, which never carry one.
    ///
    /// Optional on the wire so assistant rows written before this field existed
    /// still deserialize.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// One past answer for an assistant message. The `chat_messages` row itself
/// always mirrors the *active* version's columns (so history, streaming, and the
/// transcript need no join); these rows archive every answer so the UI can offer
/// the other versions as switchable capsules.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageVersionSummary {
    pub id: String,
    /// Which model produced this version (API-facing id).
    pub model_id: Option<String>,
    /// Whether this is the version currently shown.
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    /// Monotonic within a session; the sort key.
    pub seq: i64,
    pub role: ChatRole,
    pub content: Option<String>,
    pub tool_calls: Vec<ChatToolCall>,
    /// Which model produced this message, kept for after-the-fact traceability.
    pub model_id: Option<String>,
    pub duration_ms: Option<i64>,
    pub error: Option<String>,
    /// Structured diagnostics for a failed turn (URL, status, response body, …),
    /// shown behind a "details" disclosure in the Chat transcript.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_details: Option<crate::error::ErrorDetails>,
    pub created_at: DateTime<Utc>,
    /// Every answer recorded for this message, oldest first. Non-empty only on
    /// assistant messages returned by `list_messages`; other construction sites
    /// (append placeholders, history) leave it empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub versions: Vec<ChatMessageVersionSummary>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatAssistantRequest {
    pub name: String,
    pub system_prompt: Option<String>,
    pub default_model_id: Option<String>,
    pub enabled_tools: Option<Vec<String>>,
    pub accent: Option<String>,
}

/// Upsert the Chat assistant that owns sessions for one DBHub connection.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureDbhubChatAssistantRequest {
    pub connection_id: String,
    pub connection_name: String,
    /// MCP tool the assistant may use, e.g. `execute_sql_bigdata_etl`.
    pub tool_name: String,
}

/// Absent fields are left unchanged. `enabled_tools` uses a nested Option so
/// "not mentioned" stays distinguishable from "explicitly cleared to all tools".
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChatAssistantRequest {
    pub id: String,
    pub name: Option<String>,
    pub system_prompt: Option<String>,
    pub default_model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_tools: Option<Option<Vec<String>>>,
    pub accent: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatSessionRequest {
    pub assistant_id: String,
    pub title: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChatSessionRequest {
    pub id: String,
    pub title: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionIdRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatIdRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendRequest {
    pub session_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageIdRequest {
    pub session_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRegenerateRequest {
    pub session_id: String,
    pub message_id: String,
    /// The model to regenerate with. `None` reuses the message's own model, so
    /// the session's default is left untouched when a user only picks a model.
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSetMessageVersionRequest {
    pub session_id: String,
    pub message_id: String,
    /// The `chat_message_versions.id` to make the active/displayed version.
    pub version_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUpdateMessageRequest {
    pub session_id: String,
    pub message_id: String,
    pub content: String,
}

// --- Configurable log desensitization (redaction) rules ---------------------

/// Where a rule comes from. Built-ins are the app's fixed conservative
/// implementations (enable-only); `Custom` rules are user-supplied
/// pattern → replacement regexes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RedactRuleKind {
    Builtin,
    Custom,
}

/// One configurable redaction rule, as the frontend panel reads and edits it.
///
/// For a `Builtin` rule `pattern`/`replacement` describe the rule for the UI
/// display only; the redaction engine always uses the built-in's fixed
/// implementation and only respects `enabled`. A `Custom` rule's `pattern` is a
/// (case-sensitive) regex the engine compiles and `replacement` is a mask macro
/// or literal replacement.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactRule {
    pub id: String,
    pub name: String,
    /// One of `secret` | `pii` | `network` | `custom` — the fixed category groups
    /// the panel renders.
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replacement: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample: Option<String>,
    pub enabled: bool,
    pub kind: RedactRuleKind,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactConfig {
    pub rules: Vec<RedactRule>,
}

/// Whole-config replacement sent by the panel's Save button: rules with
/// `kind: Custom` that have an `id` update in place; rule objects with a blank
/// `id` (new custom rows) are assigned one server-side.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactSaveRequest {
    pub rules: Vec<RedactRule>,
}

/// The Redaction tab's batch-test body, mirroring the reference `/api/test`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactTestRequest {
    pub text: String,
    /// The local rule set to test against (what the panel is currently showing),
    /// so the result matches the in-panel previews without a separate save.
    pub rules: Vec<RedactRule>,
}

/// Which rules matched when a batch test ran, so the result can name hits the
/// way the reference panel does.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactTestResult {
    pub masked: String,
    pub count: u64,
    pub hits: Vec<String>,
}

// --- DBHub: database connections and network profiles ----------------------

/// What wire protocol a connection speaks. Yellowbrick rides the Postgres wire
/// protocol in this first cut (see the DBHub design, section 0).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DbConnectionKind {
    #[serde(rename = "mysql")]
    Mysql,
    #[serde(rename = "postgres")]
    Postgres,
    #[serde(rename = "yellowbrick")]
    Yellowbrick,
}

impl DbConnectionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            DbConnectionKind::Mysql => "mysql",
            DbConnectionKind::Postgres => "postgres",
            DbConnectionKind::Yellowbrick => "yellowbrick",
        }
    }
}

/// How a DBHub connection authenticates.
///
/// `manual` keeps the password in the local keychain (`db/{id}/password`).
/// `aws_secret` loads a JSON payload from AWS Secrets Manager by ARN at dial
/// time (see `aws::secrets_manager`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum DbAuthMode {
    #[default]
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "aws_secret")]
    AwsSecret,
}

impl DbAuthMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            DbAuthMode::Manual => "manual",
            DbAuthMode::AwsSecret => "aws_secret",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "manual" => Ok(DbAuthMode::Manual),
            "aws_secret" => Ok(DbAuthMode::AwsSecret),
            other => Err(format!(
                "Unknown connection auth_mode in database: {other}"
            )),
        }
    }
}

/// The SQL the AI tools may run against a connection. `select_only` is the
/// default and only lets SELECT/SHOW/DESCRIBE/EXPLAIN through; read-only
/// transaction mode enforces it a second time at the wire level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DbReadOnlyPolicy {
    #[serde(rename = "select-only")]
    SelectOnly,
}

impl DbReadOnlyPolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            DbReadOnlyPolicy::SelectOnly => "select-only",
        }
    }
}

/// A saved database connection. Bound to one AWS account: connections of
/// different accounts never see each other (DBHub design, account binding).
/// Passwords live in the secrets store under `db/{id}/password`, never here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnection {
    pub id: String,
    pub account_id: String,
    pub kind: DbConnectionKind,
    pub name: String,
    pub host: String,
    pub port: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network_profile_id: Option<String>,
    /// Show this connection as its own query tab next to Glue Catalog.
    pub show_as_tab: bool,
    /// Register the read-only SQL tool for this connection into the AI Chat.
    pub enabled_for_ai: bool,
    pub ai_read_only_policy: DbReadOnlyPolicy,
    /// Whether queries typed in this connection's own workspace may write.
    ///
    /// The read-only promise exists to bound what the *AI* can do, and the AI
    /// paths ignore this flag entirely. This is the human's escape hatch: off
    /// by default, because a connection that can write is a connection that
    /// can be written to by mistake.
    pub allow_writes: bool,
    /// `manual` (local keychain) or `aws_secret` (Secrets Manager by ARN).
    #[serde(default)]
    pub auth_mode: DbAuthMode,
    /// Bound Secrets Manager ARN when `auth_mode` is `aws_secret`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_arn: Option<String>,
    /// Display cache for the bound secret; dial uses `secret_arn`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_name: Option<String>,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Creation body for a connection. The password is optional — absent means the
/// user chose not to store it (test/manual entry will prompt again).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionInput {
    pub kind: DbConnectionKind,
    pub name: String,
    pub host: String,
    pub port: i64,
    #[serde(default)]
    pub database: Option<String>,
    pub username: String,
    #[serde(default)]
    pub network_profile_id: Option<String>,
    #[serde(default)]
    pub show_as_tab: bool,
    #[serde(default = "default_true")]
    pub enabled_for_ai: bool,
    #[serde(default)]
    pub ai_read_only_policy: Option<DbReadOnlyPolicy>,
    /// Opt in to a workspace that can write. Absent means read-only, which is
    /// the safe half of the choice to get wrong.
    #[serde(default)]
    pub allow_writes: bool,
    #[serde(default)]
    pub auth_mode: DbAuthMode,
    #[serde(default)]
    pub secret_arn: Option<String>,
    #[serde(default)]
    pub secret_name: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub password: Option<String>,
}

/// A connectivity test against values the user has typed but not saved.
///
/// Test must not write a connection row — from the user's side, probing a form
/// is a read-only act — so the dialog sends the fields a dial needs instead of
/// a connection id. `id` is carried only so an edit-time probe with a blank
/// password field can fall back to the stored secret.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionTestInput {
    #[serde(default)]
    pub id: Option<String>,
    pub kind: DbConnectionKind,
    pub host: String,
    pub port: i64,
    #[serde(default)]
    pub database: Option<String>,
    pub username: String,
    #[serde(default)]
    pub network_profile_id: Option<String>,
    /// Only present when the user typed one in this sitting.
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub auth_mode: DbAuthMode,
    #[serde(default)]
    pub secret_arn: Option<String>,
}

/// A profile test against the transport the user is still editing.
///
/// Same reason as `DbConnectionTestInput`: pressing Test must not commit a
/// profile — and its secret — to the store.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileTestInput {
    /// Set when the dialog is editing a saved profile, so a blank secret field
    /// can fall back to the one already stored.
    #[serde(default)]
    pub id: Option<String>,
    pub transport: NetworkTransport,
    /// Only when the user typed one in this sitting.
    #[serde(default)]
    pub secret: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Patch body for connection flags from the Overview card switches. Absent
/// fields stay untouched.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionFlags {
    #[serde(default)]
    pub show_as_tab: Option<bool>,
    #[serde(default)]
    pub enabled_for_ai: Option<bool>,
    #[serde(default)]
    pub ai_read_only_policy: Option<DbReadOnlyPolicy>,
    #[serde(default)]
    pub allow_writes: Option<bool>,
}

/// Update body for a connection. Absent/None fields keep their stored values;
/// `password: Some("")` clears the stored password, `Some(text)` replaces it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionUpdateInput {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<i64>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub network_profile_id: Option<String>,
    #[serde(default)]
    pub show_as_tab: Option<bool>,
    #[serde(default)]
    pub enabled_for_ai: Option<bool>,
    #[serde(default)]
    pub ai_read_only_policy: Option<DbReadOnlyPolicy>,
    #[serde(default)]
    pub allow_writes: Option<bool>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub auth_mode: Option<DbAuthMode>,
    #[serde(default)]
    pub secret_arn: Option<String>,
    #[serde(default)]
    pub secret_name: Option<String>,
}

/// Transport details for one network profile. `SshTunnel` forwards a local
/// port to the target through an SSH server (jump servers arrive in batch 6);
/// `Socks5` dials the target through a SOCKS5 proxy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// `rename_all` covers the variant tag ("ssh-tunnel"/"socks5");
// `rename_all_fields` covers the fields inside each variant (camelCase on the
// wire, matching every other DTO — without it the frontend's authMethod /
// credentialsSaved keys silently fail deserialization).
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum NetworkTransport {
    #[serde(rename = "ssh-tunnel")]
    SshTunnel {
        host: String,
        port: i64,
        username: String,
        /// How the SSH session authenticates: `password` (secret from the
        /// store), `private-key` (key file at `private_key_path`, optional
        /// passphrase from the store), or `ssh-config` (dial the local
        /// ~/.ssh/config alias named by `host` — HostName/User/Port/
        /// IdentityFile/ProxyJump all come from there and the other fields
        /// are ignored). Free-form until it crosses the wire; the resolver
        /// validates each variant.
        auth_method: String,
        /// Absolute path to the user's private key file (private-key mode).
        /// A path is configuration, not a secret — it rides in the transport
        /// JSON; the passphrase (if the key is encrypted) lives in the store.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        private_key_path: Option<String>,
        /// Whether a password/passphrase was saved — the secret itself never
        /// crosses to the WebView, only this flag is mirrored here.
        credentials_saved: bool,
    },
    #[serde(rename = "socks5")]
    Socks5 {
        host: String,
        port: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        credentials_saved: bool,
    },
}

/// The SSH authentication methods the tunnel supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshAuthMethod {
    Password,
    PrivateKey,
    SshConfig,
}

impl SshAuthMethod {
    pub fn parse(value: &str) -> crate::error::AppResult<Self> {
        match value {
            "password" => Ok(SshAuthMethod::Password),
            "private-key" => Ok(SshAuthMethod::PrivateKey),
            "ssh-config" => Ok(SshAuthMethod::SshConfig),
            other => Err(crate::error::AppError::validation(format!(
                "Unsupported SSH auth method: {other}. Use password, private-key or ssh-config."
            ))),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            SshAuthMethod::Password => "password",
            SshAuthMethod::PrivateKey => "private-key",
            SshAuthMethod::SshConfig => "ssh-config",
        }
    }
}

impl NetworkTransport {
    pub fn kind(&self) -> &'static str {
        match self {
            NetworkTransport::SshTunnel { .. } => "ssh-tunnel",
            NetworkTransport::Socks5 { .. } => "socks5",
        }
    }
}

/// A saved network profile (SSH tunnel or SOCKS5 proxy), also account-bound.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfile {
    pub id: String,
    pub account_id: String,
    pub name: String,
    pub transport: NetworkTransport,
    /// Master switch on the profile card. A disabled profile cannot serve
    /// traffic but stays configured.
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Creation/update body for a profile; `id: None` creates.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub transport: NetworkTransport,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub secret: Option<String>,
}

/// Result of a connectivity test — handshake only, no SQL.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTestResult {
    pub ok: bool,
    pub message: String,
    pub latency_ms: u64,
}

/// Body of the query-tab SQL run. maxRows caps the returned page (Rust-side
/// clamp applies).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbQueryRequest {
    pub connection_id: String,
    pub sql: String,
    #[serde(default)]
    pub max_rows: Option<usize>,
    /// Rows to skip. Non-zero means "read the next page of this statement",
    /// which re-runs it — offset paging has no cursor to resume from.
    #[serde(default)]
    pub offset: Option<usize>,
    /// The WebView's handle on this run, so the stop button can name it. Chosen
    /// by the caller because a connection may have several runs in flight.
    #[serde(default)]
    pub request_id: Option<String>,
}

/// Names the run to stop. An id the backend no longer holds means the run
/// already finished, which is not an error.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbQueryCancelRequest {
    pub request_id: String,
}

/// Asks how many rows a statement would return. Separate from `DbQueryRequest`
/// because it is a different act: nothing is paged, nothing is returned but a
/// number, and the caller has to mean it — the count re-runs the whole query.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbQueryCountRequest {
    pub connection_id: String,
    pub sql: String,
}

#[cfg(test)]
mod dbhub_wire_tests {
    use super::*;

    /// The frontend posts transport payloads with camelCase fields inside the
    /// tagged enum (NetworkProfilesSection build). Regression: before
    /// `rename_all_fields`, snake_case expectations made every profile save
    /// fail deserialization — the "Failed to create profile" bug.
    #[test]
    fn transport_deserializes_camel_case_fields() {
        let payload = serde_json::json!({
            "type": "ssh-tunnel",
            "host": "10.20.30.40",
            "port": 22,
            "username": "root",
            "authMethod": "password",
            "credentialsSaved": false
        });
        let transport: NetworkTransport =
            serde_json::from_value(payload).expect("camelCase payload must parse");
        match &transport {
            NetworkTransport::SshTunnel {
                auth_method,
                credentials_saved,
                ..
            } => {
                assert_eq!(auth_method, "password");
                assert!(!credentials_saved);
            }
            other => panic!("wrong variant: {other:?}"),
        }

        // And serializes back the same shape the UI reads.
        let json = serde_json::to_value(&transport).expect("serialize");
        assert_eq!(json["type"], "ssh-tunnel");
        assert_eq!(json["authMethod"], "password");
        assert_eq!(json["credentialsSaved"], false);
    }

    #[test]
    fn socks5_transport_roundtrips_camel_case() {
        let payload = serde_json::json!({
            "type": "socks5",
            "host": "127.0.0.1",
            "port": 1080,
            "credentialsSaved": true
        });
        let transport: NetworkTransport =
            serde_json::from_value(payload).expect("camelCase payload must parse");
        let json = serde_json::to_value(&transport).expect("serialize");
        assert_eq!(json["type"], "socks5");
        assert_eq!(json["credentialsSaved"], true);
        // Optional username absent stays absent.
        assert!(json.get("username").is_none());
    }

    /// The frontend wraps every payload in `{ request: ... }` (tauriClient's
    /// `call`), so each command's single `request` argument must deserialize
    /// from exactly the shape the services post. Regression for the second
    /// half of the "Failed to create profile" bug: the commands originally
    /// took bare `connection_id` / `input` parameters, which Tauri could not
    /// match against the wrapped `{ request }` key — every parameterised DBHub
    /// command failed, profile creation was just the first one hit.
    #[test]
    fn dbhub_command_request_payloads_parse() {
        // save_network_profile: { request: NetworkProfileInput }
        let payload = serde_json::json!({
            "id": null,
            "name": "Office tunnel",
            "transport": {
                "type": "ssh-tunnel",
                "host": "10.20.30.40",
                "port": 22,
                "username": "root",
                "authMethod": "password",
                "credentialsSaved": false
            },
            "enabled": false,
            "secret": "s3cret"
        });
        let input: NetworkProfileInput =
            serde_json::from_value(payload).expect("profile input must parse");
        assert_eq!(input.name, "Office tunnel");

        // set_db_connection_flags: { request: { connectionId, showAsTab } }
        let payload = serde_json::json!({ "connectionId": "c1", "showAsTab": true });
        let flags: DbConnectionFlagsRequest =
            serde_json::from_value(payload).expect("flags request must parse");
        assert_eq!(flags.connection_id, "c1");
        assert_eq!(flags.flags.show_as_tab, Some(true));

        // delete/test single-id commands: { request: { connectionId } }
        let request: DbConnectionRef =
            serde_json::from_value(serde_json::json!({ "connectionId": "c2" }))
                .expect("connection ref must parse");
        assert_eq!(request.connection_id, "c2");

        let request: NetworkProfileRef =
            serde_json::from_value(serde_json::json!({ "profileId": "p1" }))
                .expect("profile ref must parse");
        assert_eq!(request.profile_id, "p1");

        // create connection: { request: DbConnectionInput }
        let payload = serde_json::json!({
            "kind": "mysql",
            "name": "Sales",
            "host": "10.0.0.1",
            "port": 3306,
            "username": "reader",
            "showAsTab": true,
            "enabledForAi": true,
            "password": "hunter2"
        });
        let input: DbConnectionInput =
            serde_json::from_value(payload).expect("connection input must parse");
        assert_eq!(input.kind, DbConnectionKind::Mysql);

        // run_db_query: { request: DbQueryRequest }
        let request: DbQueryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c1", "sql": "SELECT 1", "maxRows": 100
        }))
        .expect("query request must parse");
        assert_eq!(request.connection_id, "c1");

        // list_db_tables: { request: { connectionId, database } }
        let request: DbCatalogRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c1", "database": "sales"
        }))
        .expect("catalog request must parse");
        assert_eq!(request.database, "sales");
    }
}

// --- DBHub command request wrappers ------------------------------------------
// The frontend's tauriClient wraps every payload in `{ request: ... }` (the
// repo-wide IPC convention), so each command takes exactly one `request`
// argument of one of these shapes.

/// `{ connectionId }` — the single-id commands (delete/test/catalog).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionRef {
    pub connection_id: String,
}

/// `{ profileId }` — the single-id profile commands.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileRef {
    pub profile_id: String,
}

/// Overview-card flag updates: `{ connectionId, showAsTab?, enabledForAi?,
/// aiReadOnlyPolicy? }`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionFlagsRequest {
    pub connection_id: String,
    #[serde(flatten)]
    pub flags: DbConnectionFlags,
}

/// Workspace catalog: `{ connectionId, database }`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbCatalogRequest {
    pub connection_id: String,
    pub database: String,
    /// The schema to read objects from. Empty for engines with no schema level
    /// (MySQL), and unused by the schema listing itself.
    #[serde(default)]
    pub schema: String,
    /// Which object kinds to read. Empty means tables only — the tree's
    /// default, and the cheap one: a schema's routines are not fetched to be
    /// discarded.
    #[serde(default)]
    pub kinds: Vec<String>,
}
