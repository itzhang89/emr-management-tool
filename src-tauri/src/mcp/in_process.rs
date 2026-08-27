//! In-process MCP server for the Chat page.
//!
//! A single duplex pair created lazily on the first chat request and then
//! resident for the app's lifetime: `McpTools` served on one half, an rmcp
//! client on the other. No port, no configuration, no "start the server first"
//! step — the Chat page works even with the Streamable HTTP endpoint switched
//! off. Both paths see the same tools and write to the same audit table.

use rmcp::{
    model::Tool,
    service::{RunningService, ServiceExt},
    RoleClient,
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::server::McpTools;

/// A connected in-process MCP client. Held behind a Mutex so the Chat loop can
/// borrow it across its multi-round tool-call conversation without reconnecting
/// each round.
#[derive(Default)]
pub struct InProcessClient {
    client: Mutex<Option<ConnectedClient>>,
}

/// One connected pair: an rmcp client peer plus the server-side task it drives.
///
/// rmcp's `IntoTransport` accepts `(AsyncRead, AsyncWrite)` pairs, and a
/// `DuplexStream` splits into exactly that, so both sides wire up with no
/// socket and no spawn of a separate process. This is what the design doc calls
/// the "Worker/in-process" transport.
struct ConnectedClient {
    /// The client peer, kept alive so the server-side task keeps running.
    _client: RunningService<RoleClient, ()>,
    /// Handle to the server-side task, dropped when the client is torn down.
    _server_task: tokio::task::JoinHandle<()>,
    /// The client's cancellation token.
    _cancel: CancellationToken,
}

impl InProcessClient {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ensure a live client exists and return a guard that owns it.
    pub async fn ensure(&self, app: tauri::AppHandle) -> Result<ClientGuard<'_>, String> {
        let mut slot = self.client.lock().await;
        if slot.is_none() {
            *slot = Some(connect_server_and_client(app).await?);
        }
        Ok(ClientGuard(slot))
    }

    /// Advertised tools, for building the LLM tool definitions.
    pub async fn list_tools(&self, app: tauri::AppHandle) -> Result<Vec<Tool>, String> {
        let guard = self.ensure(app).await?;
        let mut tools = guard
            .client()
            .list_all_tools()
            .await
            .map_err(|error| format!("failed to list MCP tools: {error}"))?;
        tools.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(tools)
    }
}

/// Borrows the shared client for the duration of a conversation.
pub struct ClientGuard<'a>(tokio::sync::MutexGuard<'a, Option<ConnectedClient>>);

impl<'a> ClientGuard<'a> {
    /// The live client peer, which implements `ClientServiceExt` (call_tool, …).
    pub fn client(&self) -> &RunningService<RoleClient, ()> {
        &self.0.as_ref().expect("connected")._client
    }
}

/// Connect the server and client in-process: serve `McpTools` on one half of a
/// duplex pair and drive it with a client on the other.
async fn connect_server_and_client(app: tauri::AppHandle) -> Result<ConnectedClient, String> {
    let (server_side, client_side) = tokio::io::duplex(64 * 1024);

    let server_task = tokio::spawn(async move {
        let tools = McpTools::new(app);
        let running = tools
            .serve(server_side)
            .await
            .expect("in-process MCP server starts");
        let _ = running.waiting().await;
    });

    // `()` implements `ClientHandler`, giving us a no-op client that still
    // performs the full initialize handshake and can call tools.
    let client = ()
        .serve(client_side)
        .await
        .map_err(|error| format!("failed to connect in-process MCP client: {error:?}"))?;

    Ok(ConnectedClient {
        _client: client,
        _server_task: server_task,
        _cancel: CancellationToken::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::source::AppJobDataSource;

    /// The full handshake completes over the duplex pair and the server
    /// advertises its tools. This is the transport the Chat page relies on.
    #[tokio::test]
    async fn in_process_client_lists_the_servers_tools() {
        let (server_side, client_side) = tokio::io::duplex(64 * 1024);

        let server = tokio::spawn(async move {
            // A real AppHandle can't be built in a unit test; `McpTools` only
            // uses it inside tool calls, which the handshake does not make.
            let tools = McpTools {
                data_source: AppJobDataSource::new_unavailable_for_test(),
            };
            let running = tools.serve(server_side).await.expect("serve server");
            let _ = running.waiting().await;
        });

        let client = ().serve(client_side).await.expect("serve client");

        let tools = client.list_all_tools().await.expect("list tools");
        let names: Vec<&str> = tools.iter().map(|tool| tool.name.as_ref()).collect();
        assert!(
            names.contains(&"analyze_job_failure"),
            "analyze_job_failure advertised: {names:?}"
        );
        assert!(names.contains(&"list_accounts"), "{names:?}");
        assert!(names.contains(&"find_job"), "{names:?}");
        assert!(names.contains(&"list_job_log_objects"), "{names:?}");
        assert!(names.contains(&"get_job_log_text"), "{names:?}");

        client.cancel().await.expect("client shuts down");
        server.await.expect("server task joins");
    }
}
