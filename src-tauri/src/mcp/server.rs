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
//!
//! Adding a tool takes three things:
//!
//! * A doc comment written for the *model*, not for a Rust reader: rmcp turns it
//!   into the tool's description, so editing it edits a prompt.
//! * The `#[tool]` method inside the `#[tool_router]` block below, nowhere else
//!   (see the note above that block).
//! * A body that is one `run_tool` call. Timing, auditing and serialization live
//!   there, so a new tool cannot get them subtly wrong.

use std::future::Future;

use rmcp::{
    handler::server::tool::ToolCallContext,
    handler::server::wrapper::Parameters,
    model::{
        CallToolRequestParams, CallToolResult, ContentBlock, ListToolsResult, PaginatedRequestParams,
        ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    tool, tool_handler, tool_router, ErrorData, RoleServer, ServerHandler,
};
use serde::Serialize;

use crate::error::AppResult;

use super::audit;
use super::source::AppJobDataSource;
use super::tools::analyze_job_failure::{self, AnalyzeJobFailureArgs, AnalyzeJobFailureReport};
use super::tools::dbhub_sql;
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

    /// Run one tool end-to-end: time it, audit it once, hand back JSON text.
    ///
    /// `call` is the tool's own implementation, passed as a future. Futures are
    /// lazy, so building one at the call site does no work and the timer here
    /// covers the real thing. `on_error` projects an `AppError` into the tool's
    /// *own* result type, which is why the tools return `String` rather than
    /// `Result`: the calling model always receives structured JSON it can reason
    /// about — a "not found", a degraded report — instead of a transport-level
    /// error, while the audit row keeps the message in its `error` column.
    async fn run_tool<A, T>(
        &self,
        tool: &str,
        args: &A,
        call: impl Future<Output = AppResult<T>>,
        on_error: impl FnOnce(&str) -> T,
    ) -> String
    where
        A: Serialize,
        T: Serialize,
    {
        let started = std::time::Instant::now();
        let outcome = call.await;
        let duration_ms = started.elapsed().as_millis() as i64;

        let error = outcome.as_ref().err().map(|e| e.message.to_string());
        let value = outcome.unwrap_or_else(|e| on_error(&e.message));
        // Serialized once, so the audit row and the wire response can never
        // disagree about what the caller was given.
        let result = serde_json::to_value(&value).unwrap_or_default();

        self.write_audit(
            tool,
            serde_json::to_value(args).unwrap_or_default(),
            result.clone(),
            error,
            duration_ms,
        );
        serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }

    /// Record one invocation in the app's `mcp_audit` table — the same table the
    /// Audit Log tab reads from — unless this server is the in-process transport,
    /// whose Chat loop audits instead and knows the driving provider/model.
    ///
    /// A failed write can never break the tool call: the shared writer is
    /// fire-and-forget, and results are sanitized centrally in `audit::record`
    /// (raw log bodies are dropped), so callers just pass the value through.
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
// `#[tool_router]` scans *this* impl block and collects the `#[tool]` methods it
// finds into a generated `tool_router()`, which the `#[tool_handler]` below
// dispatches through. A `#[tool]` method written in any other impl block still
// compiles — it is simply never registered, so no client ever sees it. Keep
// every tool here.

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
        self.run_tool(
            "analyze_job_failure",
            &args,
            analyze_job_failure::run(&self.data_source, &args),
            |message| AnalyzeJobFailureReport::internal_failure(&args.job_id, message),
        )
        .await
    }

    /// List the configured AWS accounts. Each entry carries only the account's
    /// display name, region, active flag and a human-readable username — never
    /// access keys, AWS account numbers, or full ARNs. Read-only.
    #[tool(name = "list_accounts")]
    async fn list_accounts(&self) -> String {
        self.run_tool(
            "list_accounts",
            // No arguments of its own; the audit row records an empty object.
            &serde_json::json!({}),
            read_only_tools::list_accounts(),
            |_| Vec::new(),
        )
        .await
    }

    /// Locate an EMR job by id across every configured account (active account
    /// first, local history then AWS). Returns the job summary, which account
    /// it was found in, and where its logs live (S3 prefix / CloudWatch group).
    /// Read-only.
    #[tool(name = "find_job")]
    async fn find_job(&self, Parameters(args): Parameters<read_only_tools::FindJobArgs>) -> String {
        self.run_tool(
            "find_job",
            &args,
            read_only_tools::find_job(&self.data_source, &args),
            read_only_tools::FindJobResult::not_found,
        )
        .await
    }

    /// List a job's S3 log objects, classified controller / driver / executor.
    /// Pass one of the returned s3Key values to get_job_log_text. Read-only.
    #[tool(name = "list_job_log_objects")]
    async fn list_job_log_objects(
        &self,
        Parameters(args): Parameters<read_only_tools::ListJobLogObjectsArgs>,
    ) -> String {
        self.run_tool(
            "list_job_log_objects",
            &args,
            read_only_tools::list_job_log_objects(&self.data_source, &args),
            |message| read_only_tools::ListJobLogObjectsResult {
                job_id: args.job_id.clone(),
                bucket: None,
                objects: Vec::new(),
                note: Some(message.to_string()),
            },
        )
        .await
    }

    /// Read the sanitized text of one of a job's S3 log objects (from
    /// list_job_log_objects). Returns the trailing tailLines lines so a huge
    /// driver log cannot blow up the model's context. Read-only.
    #[tool(name = "get_job_log_text")]
    async fn get_job_log_text(
        &self,
        Parameters(args): Parameters<read_only_tools::GetJobLogTextArgs>,
    ) -> String {
        self.run_tool(
            "get_job_log_text",
            &args,
            read_only_tools::get_job_log_text(&self.data_source, &args),
            |message| read_only_tools::GetJobLogTextResult {
                s3_key: args.s3_key.clone(),
                text: String::new(),
                returned_lines: 0,
                total_lines: 0,
                noise_filtered_lines: 0,
                truncated: false,
                error: Some(message.to_string()),
            },
        )
        .await
    }
}

impl McpTools {
    /// The app handle the tools reach AWS through. The data source owns it;
    /// exposing it here lets DBHub tools reuse the same handle without a new
    /// construction path.
    fn app_handle(&self) -> AppResult<tauri::AppHandle> {
        self.data_source.app().cloned()
    }

    /// Static EMR tools plus one `execute_sql_<slug>` per AI-enabled connection
    /// in the active account.
    async fn advertised_tools(&self) -> Vec<Tool> {
        let mut tools = Self::tool_router().list_all();
        tools.extend(dbhub_sql::advertise_execute_sql_tools().await);
        tools
    }

    async fn call_execute_sql(&self, tool_name: &str, slug: &str, args: dbhub_sql::ExecuteSqlArgs) -> String {
        let app = self.app_handle();
        let future_args = args.clone();
        let future_slug = slug.to_string();
        let result = async move {
            let app = app?;
            dbhub_sql::execute_sql_by_slug(&app, &future_slug, &future_args).await
        };
        self.run_tool(tool_name, &args, result, |message| {
            dbhub_sql::SqlQueryTextResult::refused("", &args.sql, message)
        })
        .await
    }
}

#[tool_handler]
impl ServerHandler for McpTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let supports_cache_hints = context
            .protocol_version()
            .is_some_and(|version| version >= rmcp::model::ProtocolVersion::V_2026_07_28);
        Ok(ListToolsResult {
            result_type: Some(rmcp::model::ResultType::COMPLETE),
            tools: self.advertised_tools().await,
            meta: None,
            next_cursor: None,
            ttl_ms: supports_cache_hints.then_some(0),
            cache_scope: supports_cache_hints.then_some(rmcp::model::CacheScope::Public),
        })
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        if dbhub_sql::is_dbhub_tool_name(name) {
            // Dynamic tools are resolved at list/call time from SQLite; a sync
            // get_tool cannot await, so return a synthetic descriptor with the
            // shared schema when the name looks like one of ours.
            let schema = schemars::schema_for!(dbhub_sql::ExecuteSqlArgs);
            let value = serde_json::to_value(schema).unwrap_or_default();
            return Some(Tool::new(
                name.to_string(),
                "Run ONE read-only SQL statement against an AI-enabled DBHub connection. Read-only.",
                std::sync::Arc::new(value.as_object().cloned().unwrap_or_default()),
            ));
        }
        Self::tool_router().get(name).cloned()
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::CallToolResponse, ErrorData> {
        if let Some(slug) = request.name.strip_prefix(dbhub_sql::EXECUTE_SQL_PREFIX) {
            let tool_name = request.name.to_string();
            let args: dbhub_sql::ExecuteSqlArgs = match request.arguments.as_ref() {
                Some(object) => serde_json::from_value(serde_json::Value::Object(object.clone()))
                    .map_err(|error| {
                        ErrorData::invalid_params(
                            format!("Invalid arguments for `{tool_name}`: {error}"),
                            None,
                        )
                    })?,
                None => {
                    return Err(ErrorData::invalid_params(
                        format!("`{tool_name}` requires a `sql` argument."),
                        None,
                    ));
                }
            };
            let text = self.call_execute_sql(&tool_name, slug, args).await;
            return Ok(CallToolResult::success(vec![ContentBlock::text(text)]).into());
        }

        let tcc = ToolCallContext::new(self, request, context);
        Self::tool_router().call(tcc).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::service::ServiceExt;

    /// `run_tool`'s failure path. When a tool's implementation errors, the caller
    /// still gets that tool's own result shape as JSON text — a structured "not
    /// found" carrying the message — rather than a protocol-level error, which is
    /// what lets the driving model reason about the failure instead of stalling.
    /// A malformed job id is the one failure `find_job` raises before reaching
    /// either the local history or AWS, which keeps the test hermetic.
    #[tokio::test]
    async fn a_failing_tool_answers_with_its_own_structured_json() {
        let (server_side, client_side) = tokio::io::duplex(64 * 1024);
        let server = tokio::spawn(async move {
            let tools = McpTools {
                data_source: AppJobDataSource::new_unavailable_for_test(),
                audit_enabled: false,
            };
            let running = tools.serve(server_side).await.expect("serve server");
            let _ = running.waiting().await;
        });
        let client = ().serve(client_side).await.expect("serve client");

        let arguments = serde_json::json!({ "jobId": "short" })
            .as_object()
            .cloned()
            .expect("arguments are an object");
        let outcome = client
            .call_tool(
                rmcp::model::CallToolRequestParams::new("find_job".to_string())
                    .with_arguments(arguments),
            )
            .await
            .expect("the call itself succeeds");

        let text = outcome
            .content
            .iter()
            .filter_map(|block| block.as_text().map(|text| text.text.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !outcome.is_error.unwrap_or(false),
            "a tool failure is a normal result, not a protocol error"
        );
        let value: serde_json::Value =
            serde_json::from_str(&text).expect("the tool answers with JSON");
        assert!(
            value["error"]
                .as_str()
                .unwrap_or_default()
                .contains("at least 16"),
            "the degraded result carries the failure message: {value}"
        );

        client.cancel().await.expect("client shuts down");
        server.await.expect("server task joins");
    }
}
