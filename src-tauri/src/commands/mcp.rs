use crate::error::{AppError, AppResult};
use crate::models::McpStartRequest;
use crate::state::AppState;
use nanoid::nanoid;
use tauri::{AppHandle, State as TauriState};

const TRANSPORT_SSE: &str = "sse";
const TRANSPORT_STREAMABLE_HTTP: &str = "streamableHttp";
const TRANSPORT_STDIO: &str = "stdio";

fn normalize_transport(requested: Option<&str>) -> &'static str {
    match requested {
        Some(TRANSPORT_SSE) => TRANSPORT_SSE,
        Some(TRANSPORT_STDIO) => TRANSPORT_STDIO,
        _ => TRANSPORT_STREAMABLE_HTTP,
    }
}

fn endpoint_url(transport: &str, port: u16, entry_point: &str) -> String {
    match transport {
        // stdio has no network endpoint; the agent launches the entry point directly.
        TRANSPORT_STDIO => format!("node {entry_point}"),
        TRANSPORT_SSE => format!("http://127.0.0.1:{port}/sse"),
        _ => format!("http://127.0.0.1:{port}/mcp"),
    }
}

/// While the bridge is running, publish its URL + token to a file so an
/// externally-spawned stdio MCP child (launched by Claude Code, Cursor, …) can
/// authenticate. The token still never reaches the LLM — only the local child
/// process reads it.
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
    let transport = normalize_transport(request.transport.as_deref());
    let bridge_token = nanoid!(24);

    let bridge_server = crate::mcp_bridge::start(app, bridge_token.clone()).await?;
    let bridge_port = bridge_server.port();
    let bridge_task = bridge_server.into_task();

    let mcp_path = find_mcp_entry_point()?;
    let audit_dir = crate::diagnostics::mcp_audit_dir()?;

    // Always publish bridge info so a stdio child spawned by the agent can connect.
    write_bridge_info(bridge_port, &bridge_token)?;

    // stdio: the desktop app does NOT spawn the Node process — the AI agent does,
    // over its own stdin/stdout. We only keep the bridge alive and hand back the
    // command the agent should run.
    let child = if transport == TRANSPORT_STDIO {
        None
    } else {
        Some(
            tokio::process::Command::new("node")
                .arg(&mcp_path)
                .env("MCP_BRIDGE_URL", format!("http://127.0.0.1:{}", bridge_port))
                .env("MCP_BRIDGE_TOKEN", bridge_token.clone())
                .env("MCP_PORT", port.to_string())
                .env("MCP_HOST", "127.0.0.1")
                .env("MCP_TRANSPORT", transport)
                .env("MCP_AUDIT_DIR", &audit_dir)
                .env("NODE_ENV", "production")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| AppError::internal(format!("Failed to start MCP server: {e}")))?,
        )
    };

    let pid = child.as_ref().and_then(|c| c.id());
    let entry_point = mcp_path.to_string_lossy().to_string();

    {
        let mut mcp = app_state.mcp_state.lock().map_err(|e| {
            AppError::internal(format!("Failed to acquire MCP lock: {e}"))
        })?;
        *mcp = crate::state::McpState {
            child,
            bridge_port: Some(bridge_port),
            bridge_token: Some(bridge_token),
            bridge_task: Some(bridge_task),
            mcp_port: Some(port),
            transport: Some(transport.to_string()),
        };
    }

    let health_url = format!("http://127.0.0.1:{}/health", bridge_port);

    Ok(crate::models::McpStatus {
        running: true,
        mcp_port: Some(port),
        bridge_port: Some(bridge_port),
        pid,
        health_url: Some(health_url),
        sse_url: Some(format!("http://127.0.0.1:{}/sse", port)),
        transport: Some(transport.to_string()),
        endpoint_url: Some(endpoint_url(transport, port, &entry_point)),
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

    // For stdio there is no child; "running" means the bridge task is alive.
    let running = mcp.bridge_task.is_some()
        || mcp.child.as_ref().map(|c| c.id().is_some()).unwrap_or(false);
    let pid = mcp.child.as_ref().and_then(|c| c.id());
    let mcp_port = mcp.mcp_port;
    let bridge_port = mcp.bridge_port;
    let transport = mcp.transport.clone();
    let entry_point = find_mcp_entry_point()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(crate::models::McpStatus {
        running,
        mcp_port,
        bridge_port,
        pid,
        health_url: bridge_port.map(|p| format!("http://127.0.0.1:{}/health", p)),
        sse_url: mcp_port.map(|p| format!("http://127.0.0.1:{}/sse", p)),
        endpoint_url: mcp_port.map(|p| {
            endpoint_url(normalize_transport(transport.as_deref()), p, &entry_point)
        }),
        transport,
        entry_point: Some(entry_point),
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