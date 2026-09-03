//! The MCP server: tools + lifecycle, shared by both transports.
//!
//! One `McpTools` handler is constructed identically for the in-process client
//! (the Chat page) and the Streamable HTTP endpoint (external agents), so both
//! see the same tools with the same behaviour. Audit differs only in *where* the
//! row is written: external calls are audited here (the server is the only layer
//! that sees them), while in-process Chat calls are audited by the chat loop in
//! `session.rs`, which is the one place that knows the driving provider/model.
//! Every tool invocation — current and future — is therefore audited exactly
//! once.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ServerHandler,
};

use super::audit;
use super::source::AppJobDataSource;
use super::tools::analyze_job_failure::{self, AnalyzeJobFailureArgs, AnalyzeJobFailureReport};
use super::tools::read_only as read_only_tools;

/// The tool handler. Holds the app handle so every `#[tool]` can reach AWS via
/// `AppJobDataSource` (the same paths the desktop UI uses — no bridge).
pub struct McpTools {
    pub data_source: AppJobDataSource,
    /// When true (the Streamable HTTP transport), every tool call is written to
    /// the audit table here. The in-process Chat transport constructs the server
    /// with this off and lets the chat loop audit instead, so in-process calls
    /// are not double-written.
    pub audit_enabled: bool,
}

impl McpTools {
    /// For the Streamable HTTP endpoint: audit every external invocation.
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            data_source: AppJobDataSource::new(app),
            audit_enabled: true,
        }
    }

    /// For the in-process Chat transport: the chat loop audits these calls with
    /// the provider/model that drove them, so the server stays out of the way.
    pub fn for_in_process(app: tauri::AppHandle) -> Self {
        Self {
            data_source: AppJobDataSource::new(app),
            audit_enabled: false,
        }
    }
}

// --- Audit ----------------------------------------------------------------
// Every tool invocation lands in the app's `mcp_audit` table — the same table
// the Audit Log tab reads from. A failed write can never break the tool call
// (the shared writer is fire-and-forget). Results are sanitized centrally in
// `audit::record` (raw log bodies are dropped), so handlers just pass the value.

/// Record one invocation unless this server is the in-process transport (whose
/// Chat loop audits instead, and knows the driving provider/model). A newly
/// added tool audits itself by calling this once per invocation; the Chat loop
/// needs no such call — it audits every tool it runs, new ones included.
impl McpTools {
    fn write_audit(
        &self,
        tool: &str,
        args: serde_json::Value,
        result: serde_json::Value,
        error: Option<String>,
        duration_ms: i64,
    ) {
        if self.audit_enabled {
            audit::record(tool, None, args, result, error, duration_ms, None, None);
        }
    }
}

// --- Tools ----------------------------------------------------------------

#[tool_router]
impl McpTools {
    /// Analyze an EMR on EKS job failure by id. Only jobId is required — the
    /// job is located automatically across the configured accounts (active
    /// account first, then others), so no virtual cluster or account must be
    /// supplied. Returns the job state, pod-level controller evidence (checked
    /// first — image pull failures, OOMKills and rejected service accounts
    /// never reach the Spark driver log), and the Spark application error
    /// evidence. If the jobId is malformed the tool returns error
    /// "invalidJobId" without searching: ask the user for the complete id
    /// rather than guessing.
    /// Returns a `String` JSON text output (rmcp wraps it as text content).
    #[tool(name = "analyze_job_failure")]
    async fn analyze_job_failure(
        &self,
        Parameters(args): Parameters<AnalyzeJobFailureArgs>,
    ) -> String {
        let started = std::time::Instant::now();
        let result = analyze_job_failure::run(&self.data_source, &args).await;
        let duration_ms = started.elapsed().as_millis() as i64;
        match &result {
            Ok(report) => self.write_audit(
                "analyze_job_failure",
                serde_json::to_value(&args).unwrap_or_default(),
                serde_json::to_value(report).unwrap_or_default(),
                None,
                duration_ms,
            ),
            Err(error) => self.write_audit(
                "analyze_job_failure",
                serde_json::to_value(&args).unwrap_or_default(),
                serde_json::Value::Null,
                Some(error.message.to_string()),
                duration_ms,
            ),
        }
        result
            .unwrap_or_else(|error| {
                AnalyzeJobFailureReport::internal_failure(&args.job_id, &error.message)
            })
            .to_json_text()
    }

    /// List the configured AWS accounts. Each entry carries only the account's
    /// display name, region, active flag and a human-readable username — never
    /// access keys, AWS account numbers, or full ARNs. Read-only.
    #[tool(name = "list_accounts")]
    async fn list_accounts(&self) -> String {
        let started = std::time::Instant::now();
        let outcome = read_only_tools::list_accounts().await;
        let (result, error) = match &outcome {
            Ok(accounts) => (
                serde_json::to_value(accounts).unwrap_or_default(),
                None,
            ),
            Err(error) => (
                serde_json::json!([]),
                Some(error.message.to_string()),
            ),
        };
        self.write_audit(
            "list_accounts",
            serde_json::json!({}),
            result.clone(),
            error,
            started.elapsed().as_millis() as i64,
        );
        serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }

    /// Locate an EMR job by id across every configured account (active account
    /// first, local history then AWS). Returns the job summary, which account
    /// it was found in, and where its logs live (S3 prefix / CloudWatch group).
    /// Read-only.
    #[tool(name = "find_job")]
    async fn find_job(&self, Parameters(args): Parameters<read_only_tools::FindJobArgs>) -> String {
        let started = std::time::Instant::now();
        let outcome = read_only_tools::find_job(&self.data_source, &args).await;
        let (result, error) = match &outcome {
            Ok(found) => (serde_json::to_value(found).unwrap_or_default(), None),
            Err(error) => (
                serde_json::to_value(read_only_tools::FindJobResult::not_found(&error.message))
                    .unwrap_or_default(),
                Some(error.message.to_string()),
            ),
        };
        self.write_audit(
            "find_job",
            serde_json::to_value(&args).unwrap_or_default(),
            result.clone(),
            error,
            started.elapsed().as_millis() as i64,
        );
        serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }

    /// List a job's S3 log objects, classified controller / driver / executor.
    /// Pass one of the returned s3Key values to get_job_log_text. Read-only.
    #[tool(name = "list_job_log_objects")]
    async fn list_job_log_objects(
        &self,
        Parameters(args): Parameters<read_only_tools::ListJobLogObjectsArgs>,
    ) -> String {
        let started = std::time::Instant::now();
        let outcome = read_only_tools::list_job_log_objects(&self.data_source, &args).await;
        let (result, error) = match &outcome {
            Ok(listed) => (serde_json::to_value(listed).unwrap_or_default(), None),
            Err(error) => (
                serde_json::to_value(read_only_tools::ListJobLogObjectsResult {
                    job_id: args.job_id.clone(),
                    bucket: None,
                    objects: Vec::new(),
                    note: Some(error.message.to_string()),
                })
                .unwrap_or_default(),
                Some(error.message.to_string()),
            ),
        };
        self.write_audit(
            "list_job_log_objects",
            serde_json::to_value(&args).unwrap_or_default(),
            result.clone(),
            error,
            started.elapsed().as_millis() as i64,
        );
        serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }

    /// Read the sanitized text of one of a job's S3 log objects (from
    /// list_job_log_objects). Returns the trailing tailLines lines so a huge
    /// driver log cannot blow up the model's context. Read-only.
    #[tool(name = "get_job_log_text")]
    async fn get_job_log_text(
        &self,
        Parameters(args): Parameters<read_only_tools::GetJobLogTextArgs>,
    ) -> String {
        let started = std::time::Instant::now();
        let outcome = read_only_tools::get_job_log_text(&self.data_source, &args).await;
        let (result, error) = match &outcome {
            Ok(text) => (serde_json::to_value(text).unwrap_or_default(), None),
            Err(error) => (
                serde_json::to_value(read_only_tools::GetJobLogTextResult {
                    s3_key: args.s3_key.clone(),
                    text: String::new(),
                    returned_lines: 0,
                    total_lines: 0,
                    noise_filtered_lines: 0,
                    truncated: false,
                    error: Some(error.message.to_string()),
                })
                .unwrap_or_default(),
                Some(error.message.to_string()),
            ),
        };
        self.write_audit(
            "get_job_log_text",
            serde_json::to_value(&args).unwrap_or_default(),
            result.clone(),
            error,
            started.elapsed().as_millis() as i64,
        );
        serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }
}

#[tool_handler]
impl ServerHandler for McpTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
    }
}
