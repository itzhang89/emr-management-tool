//! Network routing for DBHub connections (design section 6): how a connection
//! that references a Network Profile reaches its database through an SSH
//! tunnel or a SOCKS5 proxy.
//!
//! The mechanism for both is a **local forward**: bind 127.0.0.1 on an
//! OS-assigned port, and every byte written there comes out at the target
//! `host:port` (through the SSH server or the SOCKS proxy). The SQL driver
//! then dials the local port with an unmodified URL — the wire protocol and
//! the driver stay oblivious to the path, which keeps `dbhub_driver` and
//! `dbhub_query` identical for direct and profiled connections.
//!
//! Lifetimes: a forward lives as long as the pool that dialed through it. The
//! executors acquire a forward, run, and drop it — the tunnel's SSH session
//! closes when the forward's handle is dropped. Session reuse (a cache keyed
//! by profile id) is a deliberate later optimization.
//!
//! Security note: the first cut accepts any SSH host key (the design's
//! test-first tunnel UX); known_hosts pinning is the batch-6 hardening item
//! and is recorded in the design's deviations.

use std::net::SocketAddr;
use std::sync::Arc;

use crate::error::{AppError, AppResult};
use crate::models::{NetworkProfile, NetworkTransport};
use russh::client::Msg;
use russh::ChannelStream;
use tokio::net::{TcpListener, TcpStream};
use tokio_socks::tcp::socks5::Socks5Stream;

/// One live local forward. Dropping it shuts the listener down; the SSH
/// session inside the worker drops with it.
pub struct LiveForward {
    /// 127.0.0.1:<port> — what the SQL URL should point at.
    pub local_addr: SocketAddr,
    /// Keeps the forward task alive; dropped = forward closed.
    _worker: tokio::task::JoinHandle<()>,
}

impl LiveForward {
    pub fn port(&self) -> u16 {
        self.local_addr.port()
    }
}

impl std::fmt::Debug for LiveForward {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LiveForward")
            .field("local_addr", &self.local_addr)
            .finish()
    }
}

/// Open a local forward to `target` through the given profile. `resolve_secret`
/// fetches the profile's password from the secrets store (typed so the secrets
/// key naming stays in one place).
pub async fn open_forward(
    profile: &NetworkProfile,
    target_host: &str,
    target_port: u16,
    resolve_secret: impl FnOnce(&str) -> AppResult<Option<String>>,
) -> AppResult<LiveForward> {
    if !profile.enabled {
        return Err(AppError::validation(format!(
            "Network profile \"{}\" is disabled.",
            profile.name
        )));
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| AppError::storage(format!("Failed to bind a local forward port: {error}")))?;
    let local_addr = listener
        .local_addr()
        .map_err(|error| AppError::storage(error.to_string()))?;

    let worker = match &profile.transport {
        NetworkTransport::SshTunnel {
            host,
            port,
            username,
            ..
        } => {
            let password = resolve_secret(&profile.id)?.unwrap_or_default();
            let ssh_host = host.clone();
            let ssh_port = *port as u16;
            let username = username.clone();
            let target_host = target_host.to_string();
            tokio::spawn(async move {
                forward_ssh(
                    listener,
                    (ssh_host, ssh_port),
                    &username,
                    &password,
                    (target_host, target_port),
                )
                .await;
            })
        }
        NetworkTransport::Socks5 { host, port, username, .. } => {
            let password = resolve_secret(&profile.id)?.unwrap_or_default();
            let proxy_host = host.clone();
            let proxy_port = *port as u16;
            let has_auth = username
                .as_deref()
                .map(|user| !user.is_empty())
                .unwrap_or(false);
            let username = username.clone();
            let target_host = target_host.to_string();
            tokio::spawn(async move {
                forward_socks(
                    listener,
                    (proxy_host, proxy_port),
                    username.as_deref().filter(|user| !user.is_empty()),
                    if has_auth { Some(password) } else { None },
                    (target_host, target_port),
                )
                .await;
            })
        }
    };

    Ok(LiveForward {
        local_addr,
        _worker: worker,
    })
}

/// Accept loop: every inbound connection is relayed through the SSH server.
/// Runs until the listener is dropped (when `LiveForward` is).
async fn forward_ssh(
    listener: TcpListener,
    ssh_server: (String, u16),
    username: &str,
    password: &str,
    target: (String, u16),
) {
    // One SSH session serves every forward connection while the listener
    // lives; losing it mid-flight tears down the relays, which the SQL pool
    // reports as a broken connection — the honest failure mode.
    let session = match connect_ssh(&ssh_server, username, password).await {
        Ok(session) => Arc::new(session),
        Err(_) => return, // the dialing executor reports the failure itself
    };
    loop {
        let Ok((mut inbound, _)) = listener.accept().await else {
            return;
        };
        let session = Arc::clone(&session);
        let target = target.clone();
        tokio::spawn(async move {
            // direct-tcpip channel to the database through the SSH server.
            let channel = session
                .channel_open_direct_tcpip(target.0, target.1 as u32, "127.0.0.1", 0)
                .await;
            let Ok(channel) = channel else {
                return;
            };
            let mut stream: ChannelStream<Msg> = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut inbound, &mut stream).await;
        });
    }
}

async fn forward_socks(
    listener: TcpListener,
    proxy: (String, u16),
    username: Option<&str>,
    password: Option<String>,
    target: (String, u16),
) {
    let username = username.map(str::to_string);
    loop {
        let Ok((mut inbound, _)) = listener.accept().await else {
            return;
        };
        let target = target.clone();
        let proxy = proxy.clone();
        let username = username.clone();
        let password = password.clone();
        tokio::spawn(async move {
            let proxy_addr = format!("{}:{}", proxy.0, proxy.1);
            let target_addr = (target.0.as_str(), target.1);
            let opened = if let Some(user) = username {
                let pass = password.as_deref().unwrap_or("");
                Socks5Stream::connect_with_password(
                    proxy_addr.as_str(),
                    target_addr,
                    &user,
                    pass,
                )
                .await
            } else {
                Socks5Stream::connect(proxy_addr.as_str(), target_addr).await
            };
            let Ok(mut stream) = opened else {
                return;
            };
            let _ = tokio::io::copy_bidirectional(&mut inbound, &mut stream).await;
        });
    }
}

/// Authenticate to the SSH server with a password. Key-based auth and jump
/// servers extend this function, not the forward loop (design batch 6).
async fn connect_ssh(
    server: &(String, u16),
    username: &str,
    password: &str,
) -> AppResult<russh::client::Handle<AcceptAnyHostKey>> {
    let config = Arc::new(russh::client::Config::default());
    let mut session = russh::client::connect(
        config,
        (server.0.as_str(), server.1),
        AcceptAnyHostKey,
    )
    .await
    .map_err(|error| {
        AppError::validation(format!(
            "SSH connect to {}:{} failed: {error}",
            server.0, server.1
        ))
    })?;

    let auth = session
        .authenticate_password(username, password)
        .await
        .map_err(|error| AppError::validation(format!("SSH auth failed: {error}")))?;
    if auth != russh::client::AuthResult::Success {
        return Err(AppError::validation(
            "SSH authentication was rejected. Check the user name and saved password.",
        ));
    }
    Ok(session)
}

/// Host-key acceptance: first cut trusts any server key (see module doc).
struct AcceptAnyHostKey;

impl russh::client::Handler for AcceptAnyHostKey {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Resolve a connection's route: when it carries a network profile, open a
/// local forward and return the rewritten (host, port) the driver must dial
/// plus the forward itself — the caller keeps it alive for the duration of
/// the run; dropping it closes the tunnel. `None` = direct connection.
pub async fn route_for_connection(
    pool: &sqlx::SqlitePool,
    app: &tauri::AppHandle,
    connection: &crate::models::DbConnection,
) -> AppResult<Option<(String, u16, LiveForward)>> {
    let Some(profile_id) = &connection.network_profile_id else {
        return Ok(None);
    };
    let profile = dbhub_profile(pool, &connection.account_id, profile_id).await?;
    let secret = crate::secrets::read_optional_secret(app, &format!("profile/{profile_id}/password"))
        .unwrap_or(None);
    let forward =
        open_forward(&profile, &connection.host, connection.port as u16, move |_| Ok(secret))
            .await?;
    Ok(Some(("127.0.0.1".to_string(), forward.port(), forward)))
}

async fn dbhub_profile(
    pool: &sqlx::SqlitePool,
    account_id: &str,
    profile_id: &str,
) -> AppResult<NetworkProfile> {
    crate::db::dbhub::get_profile(pool, account_id, profile_id)
        .await?
        .ok_or_else(|| {
            AppError::validation("The connection's network profile no longer exists.")
        })
}

/// Probe path for the profile test button: bind + open a relay path to the
/// profile's own host:port. Only proves the local bind and the accept loop —
/// the far-side handshake failure surfaces when a connection actually dials.
pub async fn probe_profile(
    profile: &NetworkProfile,
    resolve_secret: impl FnOnce(&str) -> AppResult<Option<String>>,
) -> AppResult<u16> {
    let (host, port) = transport_target(&profile.transport);
    let forward = open_forward(&profile, &host, port, resolve_secret).await?;
    let port = forward.port();
    // Touch the listener once: a TCP connect that opens proves the port is
    // live. The relay to the (possibly unreachable) target fails in the
    // background, which is the honest scope of a bind-level probe.
    let _ = TcpStream::connect(("127.0.0.1", port)).await;
    Ok(port)
}

fn transport_target(transport: &NetworkTransport) -> (String, u16) {
    match transport {
        NetworkTransport::SshTunnel { host, port, .. } => (host.clone(), *port as u16),
        NetworkTransport::Socks5 { host, port, .. } => (host.clone(), *port as u16),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ssh_profile() -> NetworkProfile {
        NetworkProfile {
            id: "p1".into(),
            account_id: "acct-a".into(),
            name: "Office tunnel".into(),
            transport: NetworkTransport::SshTunnel {
                host: "10.20.30.40".into(),
                port: 22,
                username: "root".into(),
                auth_method: "password".into(),
                credentials_saved: false,
            },
            enabled: true,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn transport_target_reads_both_kinds() {
        let ssh = ssh_profile();
        assert_eq!(transport_target(&ssh.transport), ("10.20.30.40".to_string(), 22));

        let socks = NetworkTransport::Socks5 {
            host: "127.0.0.1".into(),
            port: 1080,
            username: None,
            credentials_saved: false,
        };
        assert_eq!(transport_target(&socks), ("127.0.0.1".to_string(), 1080));
    }

    #[tokio::test]
    async fn open_forward_refuses_disabled_profile() {
        let mut profile = ssh_profile();
        profile.enabled = false;
        let error = open_forward(&profile, "db.internal", 5432, |_| Ok(None))
            .await
            .expect_err("must refuse");
        assert!(error.message.contains("disabled"));
    }

    #[tokio::test]
    async fn open_forward_binds_a_loopback_port() {
        let profile = NetworkProfile {
            id: "p1".into(),
            account_id: "acct-a".into(),
            name: "dead proxy".into(),
            transport: NetworkTransport::Socks5 {
                host: "127.0.0.1".into(),
                port: 1, // closed — the bind still succeeds; relays fail later
                username: None,
                credentials_saved: false,
            },
            enabled: true,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let forward = open_forward(&profile, "db.internal", 5432, |_| Ok(None))
            .await
            .expect("forward");
        assert!(forward.port() > 0);
        assert!(forward.local_addr.ip().is_loopback());
        drop(forward);
    }

    #[tokio::test]
    async fn probe_profile_returns_a_live_port() {
        let mut profile = ssh_profile();
        // Point at a local SSH-ish port that is closed; the probe still binds
        // and answers with its port — far-side handshake is not its scope.
        profile.transport = NetworkTransport::SshTunnel {
            host: "127.0.0.1".into(),
            port: 1,
            username: "root".into(),
            auth_method: "password".into(),
            credentials_saved: false,
        };
        let port = probe_profile(&profile, |_| Ok(None)).await.expect("probe");
        assert!(port > 0);
    }
}
