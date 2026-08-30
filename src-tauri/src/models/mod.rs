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

/// One MCP tool invocation, persisted by the Node MCP server into the app's
/// SQLite database (`mcp_audit` table) and shown in the Audit Log tab.
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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuditQuery {
    pub limit: Option<usize>,
}

// --- LLM provider configuration -------------------------------------------
// A three-level structure: provider → endpoint → model. API keys live on the
// endpoint (alongside its base URL) and never enter SQLite or the WebView —
// they go to the OS keychain via `secrets`, and the frontend only ever sees a
// masked value it can replace but not read.

/// Which request/response shape an endpoint speaks. Not a vendor name: an
/// OpenAI-compatible gateway is `Openai` regardless of who runs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmProviderKind {
    Openai,
    Anthropic,
}

impl LlmProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "openai" => Some(Self::Openai),
            "anthropic" => Some(Self::Anthropic),
            _ => None,
        }
    }

    /// Suggested base URL for a brand-new endpoint. Editable, so
    /// OpenAI-compatible gateways and self-hosted endpoints work too.
    pub fn default_base_url(self) -> &'static str {
        match self {
            Self::Openai => "https://api.openai.com/v1",
            Self::Anthropic => "https://api.anthropic.com/v1",
        }
    }
}

/// One model offered by an endpoint. `model_id` is the value sent to the API;
/// `series` groups models in the UI ("claude-opus" for "claude-opus-4-8").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModel {
    pub id: String,
    pub endpoint_id: String,
    pub model_id: String,
    pub series: String,
    pub display_name: Option<String>,
    pub is_default: bool,
    pub context_window: Option<i64>,
    pub max_output_tokens: Option<i64>,
    pub created_at: DateTime<Utc>,
}

/// An API endpoint of a provider. Carries the base URL and — in the keychain,
/// never here — the API key. `has_api_key` and `api_key_masked` are what the
/// frontend gets instead of the secret.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpoint {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub base_url: String,
    pub is_default: bool,
    pub has_api_key: bool,
    pub api_key_masked: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub models: Vec<LlmModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub kind: LlmProviderKind,
    pub enabled: bool,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub endpoints: Vec<LlmEndpoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLlmProviderRequest {
    pub name: String,
    pub kind: LlmProviderKind,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmProviderRequest {
    pub id: String,
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLlmEndpointRequest {
    pub provider_id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub is_default: Option<bool>,
}

/// `api_key: None` leaves the stored key untouched — the frontend cannot read
/// it back, so "unchanged" has to be expressible as an absent field rather
/// than a round-trip of the current value.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmEndpointRequest {
    pub id: String,
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpointTestResult {
    pub ok: bool,
    pub message: String,
    pub latency_ms: i64,
    /// How many models the endpoint advertised, when it answered at all.
    pub model_count: Option<usize>,
}

/// A model the endpoint advertises, before the user chooses to import it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelCandidate {
    pub model_id: String,
    pub series: String,
    pub display_name: Option<String>,
    /// True when this endpoint already has the model stored, so the import
    /// dialog can pre-check it and label it as already added.
    pub already_added: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLlmModelsRequest {
    pub endpoint_id: String,
    pub models: Vec<AddLlmModelInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLlmModelInput {
    pub model_id: String,
    pub series: Option<String>,
    pub display_name: Option<String>,
    pub context_window: Option<i64>,
    pub max_output_tokens: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmModelRequest {
    pub id: String,
    pub series: Option<String>,
    pub display_name: Option<String>,
    pub is_default: Option<bool>,
    pub context_window: Option<i64>,
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
pub struct LlmEndpointIdRequest {
    pub endpoint_id: String,
}
