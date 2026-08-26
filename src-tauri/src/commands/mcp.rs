use crate::error::{AppError, AppResult};
use crate::models::McpStartRequest;
use crate::state::AppState;
use nanoid::nanoid;
use sqlx::Row;
use tauri::{AppHandle, State as TauriState};

const MCP_ENDPOINT_PATH: &str = "/mcp";
const DEFAULT_MCP_PORT: u16 = 5175;

fn endpoint_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}{MCP_ENDPOINT_PATH}")
}

/// While the bridge is running, publish its URL + token to a file so the Node
/// MCP child can authenticate. The token never reaches the LLM — only the
/// local child process reads it.
fn write_bridge_info(bridge_port: u16, token: &str) -> AppResult<std::path::PathBuf> {
    let path = crate::db::app_data_dir()?.join("mcp-bridge.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::storage(format!("Failed to create data dir: {e}")))?;
    }
    let body = serde_json::json!({
        "url": format!("http://127.0.0.1:{bridge_port}"),
        "token": token,
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&body).unwrap_or_default())
        .map_err(|e| AppError::storage(format!("Failed to write bridge info: {e}")))?;
    Ok(path)
}

fn remove_bridge_info() {
    if let Ok(path) = crate::db::app_data_dir().map(|d| d.join("mcp-bridge.json")) {
        let _ = std::fs::remove_file(path);
    }
}

/// True when something is already listening on 127.0.0.1:port.
fn port_in_use(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

/// Kill any leftover MCP server still holding the port.
///
/// A previous app run that exited without `mcp_stop` (crash, force-quit) leaves
/// an orphaned `node .../mcp/dist/index.js` listening on the port. Auto-bumping
/// to another port would desync the UI's "MCP Port" field and the agent configs
/// generated from it, so reclaim the requested port instead. Only processes
/// whose command line points at our own MCP entry point are touched.
async fn reclaim_mcp_port(port: u16, entry_point: &str) {
    if !port_in_use(port) {
        return;
    }

    let pids = mcp_pids_listening_on(port, entry_point).await;
    if pids.is_empty() {
        crate::diagnostics::append_log_line(
            "WARN",
            &format!(
                "MCP port {port} is in use by a process that is not our MCP server; leaving it alone."
            ),
        );
        return;
    }

    for pid in pids {
        crate::diagnostics::append_log_line(
            "INFO",
            &format!("Terminating orphaned MCP server (pid {pid}) holding port {port}."),
        );
        let _ = tokio::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status()
            .await;
    }

    // Give the listeners a moment to release the socket, then SIGKILL stragglers.
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if !port_in_use(port) {
            return;
        }
    }
    for pid in mcp_pids_listening_on(port, entry_point).await {
        let _ = tokio::process::Command::new("kill")
            .arg("-KILL")
            .arg(pid.to_string())
            .status()
            .await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
}

/// PIDs listening on the port whose command line references our MCP entry
/// point, so we never kill an unrelated process that happens to own the port.
async fn mcp_pids_listening_on(port: u16, entry_point: &str) -> Vec<u32> {
    let output = match tokio::process::Command::new("lsof")
        .args(["-nP", "-t", &format!("-iTCP@127.0.0.1:{port}"), "-sTCP:LISTEN"])
        .output()
        .await
    {
        Ok(output) => output,
        Err(e) => {
            crate::diagnostics::append_log_line(
                "WARN",
                &format!("Could not inspect port {port} holders: {e}"),
            );
            return Vec::new();
        }
    };

    let mut pids = Vec::new();
    for pid in String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .filter_map(|s| s.parse::<u32>().ok())
    {
        if process_is_our_mcp_server(pid, entry_point).await {
            pids.push(pid);
        }
    }
    pids
}

async fn process_is_our_mcp_server(pid: u32, entry_point: &str) -> bool {
    let Ok(output) = tokio::process::Command::new("ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output()
        .await
    else {
        return false;
    };
    let command = String::from_utf8_lossy(&output.stdout);
    command.contains(entry_point) || command.contains("mcp/dist/index.js")
}

#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    request: McpStartRequest,
    app_state: TauriState<'_, AppState>,
) -> AppResult<crate::models::McpStatus> {
    // Exactly one MCP server may run at a time. If this app already has one,
    // shut it down first rather than failing — the caller asked for a server on
    // a specific port and a stale instance must not shadow it.
    let already_running = {
        let mcp = app_state.mcp_state.lock().map_err(|e| {
            AppError::internal(format!("Failed to acquire MCP lock: {e}"))
        })?;
        mcp.child.is_some() || mcp.bridge_task.is_some()
    };
    if already_running {
        stop_running_mcp(&app_state).await?;
    }

    let port = request.port.unwrap_or(DEFAULT_MCP_PORT);
    let mcp_path = find_mcp_entry_point()?;
    let entry_point = mcp_path.to_string_lossy().to_string();

    // Clear orphaned MCP servers (e.g. from a previous crash) so the child can
    // bind the exact port the UI displays.
    reclaim_mcp_port(port, &entry_point).await;
    if port_in_use(port) {
        return Err(AppError::validation(format!(
            "Port {port} is already in use by another process. Choose a different port."
        )));
    }

    let bridge_token = nanoid!(24);
    let bridge_server = crate::mcp_bridge::start(app, bridge_token.clone()).await?;
    let bridge_port = bridge_server.port();
    let bridge_task = bridge_server.into_task();

    write_bridge_info(bridge_port, &bridge_token)?;

    // The only supported transport is Streamable HTTP, served by the Node
    // child on 127.0.0.1. Audit entries go to the app's SQLite database.
    let child = tokio::process::Command::new("node")
        .arg(&mcp_path)
        .env("MCP_BRIDGE_URL", format!("http://127.0.0.1:{}", bridge_port))
        .env("MCP_BRIDGE_TOKEN", bridge_token.clone())
        .env("MCP_PORT", port.to_string())
        .env("MCP_HOST", "127.0.0.1")
        .env("NODE_ENV", "production")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::internal(format!("Failed to start MCP server: {e}")))?;

    let pid = child.id();

    {
        let mut mcp = app_state.mcp_state.lock().map_err(|e| {
            AppError::internal(format!("Failed to acquire MCP lock: {e}"))
        })?;
        *mcp = crate::state::McpState {
            child: Some(child),
            bridge_port: Some(bridge_port),
            bridge_token: Some(bridge_token),
            bridge_task: Some(bridge_task),
            mcp_port: Some(port),
            transport: Some("streamableHttp".to_string()),
        };
    }

    // Confirm the child really bound the requested port; otherwise the UI would
    // advertise an endpoint nothing is listening on.
    if !wait_for_mcp_listening(port).await {
        stop_running_mcp(&app_state).await?;
        return Err(AppError::internal(format!(
            "The MCP server did not start listening on port {port}. Check the app log for details."
        )));
    }

    let health_url = format!("http://127.0.0.1:{}/health", bridge_port);

    Ok(crate::models::McpStatus {
        running: true,
        mcp_port: Some(port),
        bridge_port: Some(bridge_port),
        pid,
        health_url: Some(health_url),
        endpoint_url: Some(endpoint_url(port)),
        entry_point: Some(entry_point),
    })
}

/// Wait (briefly) for the freshly spawned child to accept connections.
async fn wait_for_mcp_listening(port: u16) -> bool {
    wait_for_mcp_listening_with_attempts(port, 50).await
}

async fn wait_for_mcp_listening_with_attempts(port: u16, attempts: u32) -> bool {
    for _ in 0..attempts {
        if port_in_use(port) {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    false
}

/// Tear down the child process and bridge task held in app state.
async fn stop_running_mcp(app_state: &TauriState<'_, AppState>) -> AppResult<bool> {
    let (child, bridge_task) = {
        let mut mcp = app_state.mcp_state.lock().map_err(|e| {
            AppError::internal(format!("Failed to acquire MCP lock: {e}"))
        })?;
        if mcp.child.is_none() && mcp.bridge_task.is_none() {
            return Ok(false);
        }
        (mcp.child.take(), mcp.bridge_task.take())
    };

    if let Some(mut child) = child {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    if let Some(task) = bridge_task {
        task.abort();
    }
    remove_bridge_info();

    let mut mcp = app_state.mcp_state.lock().map_err(|e| {
        AppError::internal(format!("Failed to acquire MCP lock: {e}"))
    })?;
    mcp.bridge_port = None;
    mcp.bridge_token = None;
    mcp.mcp_port = None;
    mcp.transport = None;

    Ok(true)
}

#[tauri::command]
pub async fn mcp_stop(app_state: TauriState<'_, AppState>) -> AppResult<bool> {
    stop_running_mcp(&app_state).await
}

#[tauri::command]
pub async fn mcp_status(app_state: TauriState<'_, AppState>) -> AppResult<crate::models::McpStatus> {
    let mcp = app_state.mcp_state.lock().map_err(|e| {
        AppError::internal(format!("Failed to acquire MCP lock: {e}"))
    })?;

    let running = mcp.bridge_task.is_some()
        || mcp.child.as_ref().map(|c| c.id().is_some()).unwrap_or(false);
    let pid = mcp.child.as_ref().and_then(|c| c.id());
    let mcp_port = mcp.mcp_port;
    let bridge_port = mcp.bridge_port;
    let entry_point = find_mcp_entry_point()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(crate::models::McpStatus {
        running,
        mcp_port,
        bridge_port,
        pid,
        health_url: bridge_port.map(|p| format!("http://127.0.0.1:{}/health", p)),
        endpoint_url: mcp_port.map(endpoint_url),
        entry_point: Some(entry_point),
    })
}

/// Read recent MCP tool invocations from the audit table for the Audit Log
/// tab. The Node MCP server writes one row per invocation into the app's
/// SQLite database; newest first.
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

fn find_mcp_entry_point() -> AppResult<std::path::PathBuf> {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let cwd = std::env::current_dir().ok();

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // Bundled: resources live next to (or inside) the app's executable directory.
    if let Some(dir) = &exe_dir {
        candidates.push(dir.join("mcp/dist/index.js"));
        // macOS .app layout: Contents/MacOS/<exe> → Contents/Resources/
        candidates.push(dir.join("../Resources/mcp/dist/index.js"));
    }

    // `tauri dev` runs with the cwd set to src-tauri/, so the repo root is one level up.
    if let Some(dir) = &cwd {
        candidates.push(dir.join("mcp/dist/index.js"));
        candidates.push(dir.join("../mcp/dist/index.js"));
    }

    for path in candidates {
        if path.exists() {
            return Ok(path);
        }
    }

    Err(AppError::validation(
        "MCP entry point not found. Run `npm run mcp:build` so that mcp/dist/index.js exists.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A port that is currently free. Ephemeral ports can be reclaimed by other
    /// tests running in parallel, so callers retry rather than assert on the
    /// first candidate.
    fn free_port() -> u16 {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind probe listener");
        listener.local_addr().expect("probe addr").port()
    }

    #[test]
    fn endpoint_url_points_at_the_requested_port() {
        assert_eq!(endpoint_url(5175), "http://127.0.0.1:5175/mcp");
        assert_eq!(endpoint_url(6000), "http://127.0.0.1:6000/mcp");
    }

    #[test]
    fn port_in_use_reports_a_bound_port() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind test listener");
        let port = listener.local_addr().expect("addr").port();
        // The listener is held for the whole assertion, so this cannot race.
        assert!(port_in_use(port), "a bound port must report as in use");
    }

    #[test]
    fn port_in_use_reports_a_free_port() {
        // Retry: a parallel test may transiently occupy the released port.
        for attempt in 0..10 {
            let port = free_port();
            if !port_in_use(port) {
                return;
            }
            assert!(attempt < 9, "no free port observed after 10 attempts");
        }
    }

    #[tokio::test]
    async fn reclaim_leaves_ports_held_by_unrelated_processes_alone() {
        // A plain listener is not our MCP server, so reclaim must not free it.
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind test listener");
        let port = listener.local_addr().expect("addr").port();
        reclaim_mcp_port(port, "/nonexistent/mcp/dist/index.js").await;
        assert!(port_in_use(port), "unrelated listeners must survive reclaim");
        drop(listener);
    }

    #[tokio::test]
    async fn wait_for_mcp_listening_gives_up_when_nothing_binds() {
        for attempt in 0..10 {
            let port = free_port();
            if port_in_use(port) {
                assert!(attempt < 9, "no free port observed after 10 attempts");
                continue;
            }
            // Nothing is listening, so the wait must terminate as false rather
            // than hang.
            assert!(!wait_for_mcp_listening_with_attempts(port, 2).await);
            return;
        }
    }
}
