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
pub struct ChatUpdateMessageRequest {
    pub session_id: String,
    pub message_id: String,
    pub content: String,
}
