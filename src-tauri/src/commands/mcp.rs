use crate::error::{AppError, AppResult};
use crate::models::{McpStartRequest, McpStatus};
use crate::state::AppState;
use sqlx::Row;
use tauri::{AppHandle, State as TauriState};

const MCP_ENDPOINT_PATH: &str = "/mcp";
const DEFAULT_MCP_PORT: u16 = 5175;

fn endpoint_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}{MCP_ENDPOINT_PATH}")
}

#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    request: McpStartRequest,
    app_state: TauriState<'_, AppState>,
) -> AppResult<McpStatus> {
    // Exactly one MCP server may run at a time. If this app already has one,
    // shut it down first rather than failing — the caller asked for a server on
    // a specific port and a stale instance must not shadow it.
    if mcp_state_running(&app_state)? {
        stop_running_mcp(&app_state).await?;
    }

    let port = request.port.unwrap_or(DEFAULT_MCP_PORT);
    // Binding happens inside http::start before it returns, so a busy port
    // fails here loudly rather than leaving the UI advertising a dead endpoint.
    let task = crate::mcp::http::start(app, port).await?;

    {
        let mut mcp = app_state.mcp_state.lock().map_err(|e| {
            AppError::internal(format!("Failed to acquire MCP lock: {e}"))
        })?;
        mcp.task = Some(task);
        mcp.mcp_port = Some(port);
        mcp.transport = Some("streamableHttp".to_string());
    }

    Ok(McpStatus {
        running: true,
        mcp_port: Some(port),
        endpoint_url: Some(endpoint_url(port)),
    })
}

/// Tear down the axum server held in app state. Nothing outlives the app
/// process, so there is no orphaned-child reclamation to do.
async fn stop_running_mcp(app_state: &TauriState<'_, AppState>) -> AppResult<bool> {
    let task = {
        let mut mcp = app_state.mcp_state.lock().map_err(|e| {
            AppError::internal(format!("Failed to acquire MCP lock: {e}"))
        })?;
        mcp.task.take()
    };

    let stopped = task.is_some();
    if let Some(task) = task {
        task.abort();
    }

    let mut mcp = app_state.mcp_state.lock().map_err(|e| {
        AppError::internal(format!("Failed to acquire MCP lock: {e}"))
    })?;
    mcp.mcp_port = None;
    mcp.transport = None;

    Ok(stopped)
}

#[tauri::command]
pub async fn mcp_stop(app_state: TauriState<'_, AppState>) -> AppResult<bool> {
    stop_running_mcp(&app_state).await
}

#[tauri::command]
pub async fn mcp_status(app_state: TauriState<'_, AppState>) -> AppResult<McpStatus> {
    let mcp = app_state.mcp_state.lock().map_err(|e| {
        AppError::internal(format!("Failed to acquire MCP lock: {e}"))
    })?;

    let running = mcp.task.is_some();
    let mcp_port = mcp.mcp_port;

    Ok(McpStatus {
        running,
        mcp_port,
        endpoint_url: mcp_port.map(endpoint_url),
    })
}

/// Read recent MCP tool invocations from the audit table for the Audit Log
/// tab. The MCP server writes one row per invocation into the app's SQLite
/// database; newest first.
#[tauri::command]
pub async fn list_mcp_audit_entries(
    request: Option<crate::models::McpAuditQuery>,
) -> AppResult<Vec<crate::models::McpAuditEntry>> {
    let limit = request.and_then(|r| r.limit).unwrap_or(200).min(1000) as i64;
    let pool = crate::db::repository::pool().await?;

    let rows = sqlx::query(
        "select id, timestamp, status, tool, client, duration_ms, args_json, result_json, error
         from mcp_audit
         order by timestamp desc
         limit ?1",
    )
    .bind(limit)
    .fetch_all(&pool)
    .await
    .map_err(|e| AppError::storage(format!("Failed to read audit entries: {e}")))?;

    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let args_json: String = row.get("args_json");
        let result_json: String = row.get("result_json");
        entries.push(crate::models::McpAuditEntry {
            id: row.get("id"),
            timestamp: row.get("timestamp"),
            status: row.get("status"),
            tool: row.get("tool"),
            client: row.get("client"),
            duration_ms: row.get("duration_ms"),
            args: serde_json::from_str(&args_json).unwrap_or(serde_json::Value::Null),
            result: serde_json::from_str(&result_json).unwrap_or(serde_json::Value::Null),
            error: row.get("error"),
        });
    }

    Ok(entries)
}

fn mcp_state_running(app_state: &TauriState<'_, AppState>) -> AppResult<bool> {
    let mcp = app_state.mcp_state.lock().map_err(|e| {
        AppError::internal(format!("Failed to acquire MCP lock: {e}"))
    })?;
    Ok(mcp.task.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_url_points_at_the_requested_port() {
        assert_eq!(endpoint_url(5175), "http://127.0.0.1:5175/mcp");
        assert_eq!(endpoint_url(6000), "http://127.0.0.1:6000/mcp");
    }
}
