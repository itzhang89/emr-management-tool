//! The MCP server: tools + lifecycle, shared by both transports.
//!
//! One `McpTools` handler is constructed identically for the in-process client
//! (the Chat page) and the Streamable HTTP endpoint (external agents), so both
//! see the same tools with the same behaviour and both write to the same audit
//! table.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ServerHandler,
};

use crate::models::McpAuditEntry;

use super::source::AppJobDataSource;
use super::tools::analyze_job_failure::{self, AnalyzeJobFailureArgs, AnalyzeJobFailureReport};
use super::tools::read_only as read_only_tools;

/// The tool handler. Holds the app handle so every `#[tool]` can reach AWS via
/// `AppJobDataSource` (the same paths the desktop UI uses — no bridge).
pub struct McpTools {
    pub data_source: AppJobDataSource,
}

impl McpTools {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            data_source: AppJobDataSource::new(app),
        }
    }
}

// --- Audit ----------------------------------------------------------------
// Every tool invocation lands in the app's `mcp_audit` table — the same table
// the Audit Log tab reads from. Unlike the old HTTP bridge, there is no DTO
// casing mismatch that could silently drop rows, and a failed write can never
// break the tool call (it is fire-and-forget).

fn audit_result_for(report: &AnalyzeJobFailureReport) -> serde_json::Value {
    match serde_json::to_value(report) {
        Ok(mut value) => {
            // The full raw log tails would bloat the audit row; the structured
            // evidence fields are kept.
            if let Some(evidence) = value
                .get_mut("evidence")
                .and_then(|evidence| evidence.as_object_mut())
            {
                evidence.remove("rawLogs");
            }
            if let Some(controller) = value
                .get_mut("controllerEvidence")
                .and_then(|controller| controller.as_object_mut())
            {
                controller.remove("rawLogs");
            }
            value
        }
        Err(_) => serde_json::Value::Null,
    }
}

/// Write one audit row, fire-and-forget. Callers never await it.
fn audit(
    tool: &str,
    client: Option<&str>,
    args: serde_json::Value,
    result: serde_json::Value,
    error: Option<String>,
) {
    let started_at = chrono::Utc::now();
    let tool = tool.to_string();
    let client = client.map(ToString::to_string);
    tauri::async_runtime::spawn(async move {
        let pool = match crate::db::repository::pool().await {
            Ok(pool) => pool,
            Err(error) => {
                crate::diagnostics::append_log_line(
                    "WARN",
                    &format!("mcp audit: failed to open database: {error}"),
                );
                return;
            }
        };
        let entry = McpAuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: started_at.to_rfc3339(),
            status: if error.is_some() { "error" } else { "success" }.to_string(),
            tool,
            client,
            duration_ms: (chrono::Utc::now() - started_at).num_milliseconds(),
            args,
            result,
            error,
        };
        if let Err(error) = crate::db::repository::insert_mcp_audit_entry(&pool, &entry).await {
            crate::diagnostics::append_log_line(
                "WARN",
                &format!("mcp audit: failed to write entry: {error}"),
            );
        }
    });
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
        let result = analyze_job_failure::run(&self.data_source, &args).await;
        match &result {
            Ok(report) => audit(
                "analyze_job_failure",
                None,
                serde_json::to_value(&args).unwrap_or_default(),
                audit_result_for(report),
                None,
            ),
            Err(error) => audit(
                "analyze_job_failure",
                None,
                serde_json::to_value(&args).unwrap_or_default(),
                serde_json::Value::Null,
                Some(error.message.to_string()),
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
        let accounts = read_only_tools::list_accounts().await.unwrap_or_default();
        serde_json::to_string(&accounts).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }

    /// Locate an EMR job by id across every configured account (active account
    /// first, local history then AWS). Returns the job summary, which account
    /// it was found in, and where its logs live (S3 prefix / CloudWatch group).
    /// Read-only.
    #[tool(name = "find_job")]
    async fn find_job(&self, Parameters(args): Parameters<read_only_tools::FindJobArgs>) -> String {
        serde_json::to_string(
            &read_only_tools::find_job(&self.data_source, &args)
                .await
                .unwrap_or_else(|error| read_only_tools::FindJobResult::not_found(&error.message)),
        )
        .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }

    /// List a job's S3 log objects, classified controller / driver / executor.
    /// Pass one of the returned s3Key values to get_job_log_text. Read-only.
    #[tool(name = "list_job_log_objects")]
    async fn list_job_log_objects(
        &self,
        Parameters(args): Parameters<read_only_tools::ListJobLogObjectsArgs>,
    ) -> String {
        serde_json::to_string(
            &read_only_tools::list_job_log_objects(&self.data_source, &args)
                .await
                .unwrap_or_else(|error| read_only_tools::ListJobLogObjectsResult {
                    job_id: args.job_id.clone(),
                    bucket: None,
                    objects: Vec::new(),
                    note: Some(error.message.to_string()),
                }),
        )
        .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }

    /// Read the sanitized text of one of a job's S3 log objects (from
    /// list_job_log_objects). Returns the trailing tailLines lines so a huge
    /// driver log cannot blow up the model's context. Read-only.
    #[tool(name = "get_job_log_text")]
    async fn get_job_log_text(
        &self,
        Parameters(args): Parameters<read_only_tools::GetJobLogTextArgs>,
    ) -> String {
        serde_json::to_string(
            &read_only_tools::get_job_log_text(&self.data_source, &args)
                .await
                .unwrap_or_else(|error| read_only_tools::GetJobLogTextResult {
                    s3_key: args.s3_key.clone(),
                    text: String::new(),
                    returned_lines: 0,
                    total_lines: 0,
                    noise_filtered_lines: 0,
                    truncated: false,
                    error: Some(error.message.to_string()),
                }),
        )
        .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }
}

#[tool_handler]
impl ServerHandler for McpTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
    }
}
