use crate::error::{AppError, AppResult};
use crate::models::McpStartRequest;
use crate::state::AppState;
use nanoid::nanoid;
use tauri::{AppHandle, State as TauriState};

const MCP_ENDPOINT_PATH: &str = "/mcp";

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

#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    request: McpStartRequest,
    app_state: TauriState<'_, AppState>,
) -> AppResult<crate::models::McpStatus> {
    {
        let mcp = app_state.mcp_state.lock().map_err(|e| {
            AppError::internal(format!("Failed to acquire MCP lock: {e}"))
        })?;
        if mcp.child.is_some() || mcp.bridge_task.is_some() {
            return Err(AppError::validation(
                "MCP server is already running. Stop it first.",
            ));
        }
    }

    let port = request.port.unwrap_or(5175);
    let bridge_token = nanoid!(24);

    let bridge_server = crate::mcp_bridge::start(app, bridge_token.clone()).await?;
    let bridge_port = bridge_server.port();
    let bridge_task = bridge_server.into_task();

    let mcp_path = find_mcp_entry_point()?;
    let audit_dir = crate::diagnostics::mcp_audit_dir()?;

    write_bridge_info(bridge_port, &bridge_token)?;

    // The only supported transport is Streamable HTTP, served by the Node
    // child on 127.0.0.1.
    let child = tokio::process::Command::new("node")
        .arg(&mcp_path)
        .env("MCP_BRIDGE_URL", format!("http://127.0.0.1:{}", bridge_port))
        .env("MCP_BRIDGE_TOKEN", bridge_token.clone())
        .env("MCP_PORT", port.to_string())
        .env("MCP_HOST", "127.0.0.1")
        .env("MCP_AUDIT_DIR", &audit_dir)
        .env("NODE_ENV", "production")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::internal(format!("Failed to start MCP server: {e}")))?;

    let pid = child.id();
    let entry_point = mcp_path.to_string_lossy().to_string();

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

#[tauri::command]
pub async fn mcp_stop(app_state: TauriState<'_, AppState>) -> AppResult<bool> {
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

/// Read recent MCP tool invocations from the audit log for the Audit Log tab.
///
/// The Node MCP server appends one JSON line per invocation to
/// `mcp-audit-YYYY-MM-DD.jsonl` files. Read them newest-first, newest entries
/// first, and return at most `limit` entries.
#[tauri::command]
pub async fn list_mcp_audit_entries(
    request: Option<crate::models::McpAuditQuery>,
) -> AppResult<Vec<crate::models::McpAuditEntry>> {
    let limit = request.and_then(|r| r.limit).unwrap_or(200).min(1000);
    let dir = crate::diagnostics::mcp_audit_dir()?;

    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| AppError::storage(format!("Failed to read audit dir: {e}")))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("mcp-audit-") && n.ends_with(".jsonl"))
                .unwrap_or(false)
        })
        .collect();
    // Newest file first (filenames sort chronologically).
    files.sort();
    files.reverse();

    let mut entries: Vec<crate::models::McpAuditEntry> = Vec::new();
    for path in files {
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let mut lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
        // Newest entries first within a file.
        lines.reverse();
        for line in lines {
            if entries.len() >= limit {
                break;
            }
            if let Some(entry) = parse_audit_line(line) {
                entries.push(entry);
            }
        }
        if entries.len() >= limit {
            break;
        }
    }

    Ok(entries)
}

fn parse_audit_line(line: &str) -> Option<crate::models::McpAuditEntry> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    Some(crate::models::McpAuditEntry {
        id: value.get("id")?.as_str()?.to_string(),
        timestamp: value.get("timestamp")?.as_str()?.to_string(),
        tool: value.get("tool")?.as_str()?.to_string(),
        args: value.get("args").cloned().unwrap_or(serde_json::Value::Null),
        result_preview: value
            .get("resultPreview")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        duration: value.get("duration").and_then(|d| d.as_i64()).unwrap_or(0),
        error: value
            .get("error")
            .and_then(|e| e.as_str())
            .map(String::from),
    })
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
