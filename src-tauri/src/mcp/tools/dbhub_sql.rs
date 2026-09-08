//! The DBHub SQL tools for the MCP server (design section 8): a *static*
//! two-tool capability face over per-connection read-only queries.
//!
//! `list_databases` projects the active account's AI-enabled connections —
//! names and kinds only, never hosts, ports or usernames (the same LLM-safe
//! rule `list_accounts` follows). `sql_query_text` re-resolves the connection
//! at call time inside the active account, refuses disabled ones and foreign
//! ids alike, then runs the statement through the read-only gate + read-only
//! transaction in `dbhub_query`. Both routes write an audit row through the
//! server's `run_tool`, so Chat-driven and agent-driven calls are audited
//! exactly once like every other tool.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::db::{dbhub, dbhub_query, repository};
use crate::error::{AppError, AppResult};

/// Hard cap on rows one tool call may return (design: protect the model's
/// context; the UI path caps at 500).
const TOOL_MAX_ROWS: usize = 100;
/// Text-size cap per cell and per result — mirrors the chat tools' rule of
/// explicit `[truncated]` markers rather than silent cuts.
const CELL_CAP: usize = 2_000;
const RESULT_TEXT_CAP: usize = 60_000;

/// The LLM-safe projection of one connection. Deliberately narrower than
/// `DbConnection`: the model learns *what* it can query, not *where*.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeDbConnection {
    pub connection_id: String,
    pub name: String,
    pub kind: String,
    pub database: Option<String>,
}

pub async fn list_databases() -> AppResult<Vec<SafeDbConnection>> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    Ok(dbhub::list_connections(&pool, &account_id)
        .await?
        .into_iter()
        .filter(|connection| connection.enabled_for_ai)
        .map(|connection| SafeDbConnection {
            connection_id: connection.id,
            name: connection.name,
            kind: connection.kind.as_str().to_string(),
            database: connection.database,
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabasesArgs {}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SqlQueryTextArgs {
    /// The connectionId of one entry from list_databases.
    pub connection_id: String,
    /// One read-only SQL statement (SELECT/SHOW/DESCRIBE/EXPLAIN). Anything
    /// else is refused by the read-only gate — the connection cannot be
    /// modified through this tool.
    pub sql: String,
    /// Maximum rows to return (1-100). Defaults to 50.
    #[serde(default)]
    #[schemars(description = "Maximum rows to return (1-100). Defaults to 50.")]
    pub max_rows: Option<usize>,
}

/// The tool's own result shape: on success the columns/rows of the page plus
/// honest truncation flags; on failure a structured error the model can act on.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlQueryTextResult {
    pub connection_id: String,
    pub sql: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<serde_json::Value>>,
    pub returned_rows: usize,
    pub total_rows_matched: usize,
    pub truncated: bool,
    /// Set when the result text was cut for the model's context.
    pub result_text_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SqlQueryTextResult {
    pub fn refused(connection_id: &str, sql: &str, message: &str) -> Self {
        Self {
            connection_id: connection_id.to_string(),
            sql: sql.to_string(),
            columns: None,
            rows: None,
            returned_rows: 0,
            total_rows_matched: 0,
            truncated: false,
            result_text_truncated: false,
            note: None,
            error: Some(message.to_string()),
        }
    }
}

pub async fn sql_query_text(app: &tauri::AppHandle, args: &SqlQueryTextArgs) -> AppResult<SqlQueryTextResult> {
    let max_rows = args.max_rows.unwrap_or(50).clamp(1, TOOL_MAX_ROWS);

    // Resolution happens per call inside the active account: a connection that
    // was deleted, disabled for AI, or belongs to another account is refused
    // here rather than at advertisement time (tools are static; data is not).
    let shape = resolve_shape(app, &args.connection_id).await?;

    let result = dbhub_query::execute_read_only(&shape, &args.sql, max_rows).await?;

    // Text-size honesty: serialize the page once; if the model-facing text
    // overshoots the cap it is cut at a char boundary and marked — the model
    // is told, never left to assume the page was complete.
    let serialized = serde_json::to_string(&result.rows).unwrap_or_default();
    let result_text_truncated = serialized.len() > RESULT_TEXT_CAP;

    Ok(SqlQueryTextResult {
        connection_id: args.connection_id.clone(),
        sql: args.sql.clone(),
        columns: Some(result.columns),
        rows: Some(
            result
                .rows
                .into_iter()
                .map(|row| cap_cells(row, CELL_CAP))
                .collect(),
        ),
        returned_rows: result.row_count,
        total_rows_matched: result.row_count,
        truncated: result.truncated,
        result_text_truncated,
        note: if result.truncated {
            Some(format!(
                "Result page capped at {max_rows} rows. Narrow the query (WHERE / LIMIT) for more."
            ))
        } else {
            None
        },
        error: None,
    })
}

/// Cap any string cell in the row object so one wide value cannot dominate.
fn cap_cells(mut row: serde_json::Value, cap: usize) -> serde_json::Value {
    if let serde_json::Value::Object(map) = &mut row {
        for (_, value) in map.iter_mut() {
            if let serde_json::Value::String(text) = value {
                if text.len() > cap {
                    let mut cut_at = cap;
                    while !text.is_char_boundary(cut_at) {
                        cut_at -= 1;
                    }
                    text.truncate(cut_at);
                    text.push_str("…[truncated]");
                }
            }
        }
    }
    row
}

async fn active_account_id(pool: &sqlx::SqlitePool) -> AppResult<String> {
    repository::active_aws_account(pool)
        .await?
        .map(|account| account.id)
        .ok_or_else(|| {
            AppError::validation("No active AWS account. Configure one in Settings first.")
        })
}

async fn resolve_shape(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> AppResult<dbhub_query::DbConnectionShape> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    let connection = dbhub::get_connection(&pool, &account_id, connection_id)
        .await?
        .ok_or_else(|| {
            // Foreign and missing ids read identically — no oracle for ids of
            // other accounts.
            AppError::validation("Connection was not found in the active account.")
        })?;
    if !connection.enabled_for_ai {
        return Err(AppError::validation(
            "This connection is not enabled for AI queries. Enable it on the DBHub Overview card.",
        ));
    }
    let password =
        crate::secrets::read_optional_secret(app, &format!("db/{connection_id}/password"))
            .unwrap_or(None);
    Ok(dbhub_query::DbConnectionShape {
        pool: repository::pool().await?,
        connection,
        password,
    })
}

/// The rmcp `#[tool]` macro in `mcp/server.rs` turns these doc comments into
/// the model-facing tool descriptions; the args structs below (with their
/// `#[schemars(description = ...)]` notes) become the JSON schemas. Kept as
/// plain types here so the server's router stays the single source of
/// advertisement.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_projection_omits_host_port_username() {
        let projection = SafeDbConnection {
            connection_id: "c1".into(),
            name: "Sales MySQL".into(),
            kind: "mysql".into(),
            database: Some("sales".into()),
        };
        let json = serde_json::to_string(&projection).expect("serialize");
        assert!(json.contains("connectionId"));
        assert!(!json.contains("host"));
        assert!(!json.contains("port"));
        assert!(!json.contains("username"));
    }

    #[test]
    fn cell_caps_mark_truncation() {
        let row = serde_json::json!({ "note": "x".repeat(5_000), "id": 7 });
        let capped = cap_cells(row, CELL_CAP);
        let note = capped.get("note").and_then(|value| value.as_str()).expect("string");
        assert!(note.len() < 5_000);
        assert!(note.ends_with("[truncated]"));
        // Non-string values untouched.
        assert_eq!(capped.get("id"), Some(&serde_json::json!(7)));
    }

    #[test]
    fn refusal_carries_structured_error() {
        let refused = SqlQueryTextResult::refused("c1", "SELECT 1", "Connection was not found.");
        assert_eq!(refused.error.as_deref(), Some("Connection was not found."));
        assert_eq!(refused.returned_rows, 0);
    }

    #[test]
    fn tool_schemas_are_read_only_contract() {
        // The schema_for! round-trip validates the args shapes the rmcp macro
        // will embed as the tools' inputSchema.
        let schema = schemars::schema_for!(SqlQueryTextArgs);
        let json = serde_json::to_string(&schema).expect("schema");
        assert!(json.contains("connectionId"));
        assert!(json.contains("sql"));
        let _ = schemars::schema_for!(ListDatabasesArgs);
    }
}
