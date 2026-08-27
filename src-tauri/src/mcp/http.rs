//! Streamable HTTP transport for the MCP server.
//!
//! Mounted on an axum route when the user toggles the MCP server on from the
//! MCP page. Uses rmcp's `StreamableHttpService` in stateless + JSON response
//! mode, matching the behaviour the old Node server had: every POST is
//! self-contained and answered with `application/json` rather than an SSE
//! stream, so external agents (Claude Code, Cursor, …) connect exactly as they
//! did before.

use std::sync::Arc;

use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService,
    session::never::NeverSessionManager,
};

use super::server::McpTools;

/// Run the HTTP MCP server on `127.0.0.1:{port}`, returning a `JoinHandle` so
/// the caller can abort it when the server is toggled off.
///
/// The server is stateless (`legacy_session_mode: false`) and uses
/// `json_response: true` so every POST returns a JSON body rather than an SSE
/// stream — the same behaviour the old Node server had. `allowed_hosts` stays
/// at the rmcp loopback default, which is DNS-rebinding protection the old
/// server did not have.
pub async fn start(
    app: tauri::AppHandle,
    port: u16,
) -> Result<tokio::task::JoinHandle<()>, crate::error::AppError> {
    use crate::error::AppError;

    if port < 1024 || port > u16::MAX / 2 {
        return Err(AppError::validation("Port must be between 1024 and 65535."));
    }

    // Bind before constructing the service so we fail fast if the port is busy.
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                AppError::validation(format!(
                    "Port {port} is already in use. Choose a different port."
                ))
            } else {
                AppError::internal(format!("Failed to bind MCP HTTP port {port}: {error}"))
            }
        })?;

    let service = StreamableHttpService::new(
        // A fresh `McpTools` per request, since the transport is stateless.
        move || {
            Ok(McpTools::new(app.clone()))
        },
        Arc::new(NeverSessionManager::default()),
        StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            .with_json_response(true),
    );

    let app_router = axum::Router::new().route_service("/mcp", service);

    let handle = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app_router).await {
            crate::diagnostics::append_log_line(
                "ERROR",
                &format!("MCP HTTP server error: {error}"),
            );
        }
    });

    Ok(handle)
}