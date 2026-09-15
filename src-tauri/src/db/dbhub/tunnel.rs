//! Network routing for DBHub connections (design section 6): how a connection
//! that references a Network Profile reaches its database through an SSH
//! tunnel or a SOCKS5 proxy.
//!
//! The mechanism for both is a **local forward**: bind 127.0.0.1 on an
//! OS-assigned port, and every byte written there comes out at the target
//! `host:port` (through the SSH server or the SOCKS proxy). The SQL driver
//! then dials the local port with an unmodified URL — the wire protocol and
//! the driver stay oblivious to the path, so every driver in `dbhub::driver`
//! serves direct and profiled connections with the same code.
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

use super::driver::DialTarget;
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

impl Drop for LiveForward {
    fn drop(&mut self) {
        // A JoinHandle detaches by default. Abort explicitly so a timed-out
        // query cannot leave a forward worker and SSH session behind.
        self._worker.abort();
    }
}

/// Open a local forward to `target` through the given profile. `resolve_secret`
/// fetches the profile's password from the secrets store (typed so the secrets
/// key naming stays in one place). Disabled profiles are refused — real
/// traffic may not route through them.
pub async fn open_forward(
    profile: &NetworkProfile,
    target_host: &str,
    target_port: u16,
    resolve_secret: impl FnOnce(&str) -> AppResult<Option<String>>,
) -> AppResult<LiveForward> {
    open_forward_inner(profile, target_host, target_port, false, resolve_secret).await
}

/// Probe variant: a disabled profile can still be tested — `enabled` gates
/// routing, not configuration validation.
pub async fn probe_forward(
    profile: &NetworkProfile,
    target_host: &str,
    target_port: u16,
    resolve_secret: impl FnOnce(&str) -> AppResult<Option<String>>,
) -> AppResult<LiveForward> {
    open_forward_inner(profile, target_host, target_port, true, resolve_secret).await
}

async fn open_forward_inner(
    profile: &NetworkProfile,
    target_host: &str,
    target_port: u16,
    allow_disabled: bool,
    resolve_secret: impl FnOnce(&str) -> AppResult<Option<String>>,
) -> AppResult<LiveForward> {
    if !profile.enabled && !allow_disabled {
        return Err(AppError::validation(format!(
            "Network profile \"{}\" is disabled. Enable it (and Apply) before routing connections through it.",
            profile.name
        )));
    }

    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| {
        AppError::storage(format!("Failed to bind a local forward port: {error}"))
    })?;
    let local_addr = listener
        .local_addr()
        .map_err(|error| AppError::storage(error.to_string()))?;

    let worker = match &profile.transport {
        NetworkTransport::SshTunnel {
            host,
            port,
            username,
            auth_method,
            private_key_path,
            ..
        } => {
            // The secret doubles as the password (password auth) or the key
            // passphrase (private-key / ssh-config auth).
            let secret = resolve_secret(&profile.id)?;
            let endpoint = resolve_ssh_endpoint(
                host,
                *port,
                username,
                auth_method,
                private_key_path.as_deref(),
                secret,
            )?;
            let target_host = target_host.to_string();
            tokio::spawn(async move {
                forward_ssh(listener, endpoint, (target_host, target_port)).await;
            })
        }
        NetworkTransport::Socks5 {
            host,
            port,
            username,
            ..
        } => {
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
/// Runs until the listener is dropped (when `LiveForward` is). The ssh
/// endpoint + credentials arrive pre-resolved: `ssh-config` alias mode has
/// already been expanded into concrete (host, port, user, key) by
/// `resolve_ssh_endpoint` before this runs.
async fn forward_ssh(listener: TcpListener, endpoint: SshEndpoint, target: (String, u16)) {
    // One SSH session serves every forward connection while the listener
    // lives; losing it mid-flight tears down the relays, which the SQL pool
    // reports as a broken connection — the honest failure mode.
    let session = match connect_ssh(&endpoint).await {
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
                Socks5Stream::connect_with_password(proxy_addr.as_str(), target_addr, &user, pass)
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

/// One concrete SSH dial: everything `connect_ssh` needs after resolution.
#[derive(Debug, Clone)]
pub struct SshEndpoint {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

#[derive(Debug, Clone)]
pub enum SshAuth {
    /// Secret from the store (the profile's password field).
    Password { secret: String },
    /// Private key file on disk; optional passphrase from the store.
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
}

/// Expand a profile's SSH transport into a concrete endpoint. In
/// `ssh-config` mode the alias comes from `host`, and HostName/User/Port/
/// IdentityFile (plus the config's own jump chain, via russh's config support)
/// are read from the user's ~/.ssh/config — the other form fields are ignored
/// so the alias stays the single source of truth, exactly like the CLI.
pub fn resolve_ssh_endpoint(
    host: &str,
    port: i64,
    username: &str,
    auth_method: &str,
    private_key_path: Option<&str>,
    secret: Option<String>,
) -> AppResult<SshEndpoint> {
    let method = crate::models::SshAuthMethod::parse(auth_method)?;
    match method {
        crate::models::SshAuthMethod::Password => Ok(SshEndpoint {
            host: host.to_string(),
            port: port as u16,
            username: username.to_string(),
            auth: SshAuth::Password {
                secret: secret.unwrap_or_default(),
            },
        }),
        crate::models::SshAuthMethod::PrivateKey => {
            let key_path = private_key_path
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::validation(
                        "Private-key auth needs a key file path. Point at your ~/.ssh/id_ed25519 (or equivalent).",
                    )
                })?;
            Ok(SshEndpoint {
                host: host.to_string(),
                port: port as u16,
                username: username.to_string(),
                auth: SshAuth::PrivateKey {
                    key_path: key_path.to_string(),
                    passphrase: secret.filter(|value| !value.is_empty()),
                },
            })
        }
        crate::models::SshAuthMethod::SshConfig => {
            let resolved = resolve_ssh_config_alias(host)?;
            Ok(SshEndpoint {
                host: resolved.host,
                port: resolved.port,
                username: resolved.username,
                // The key path from the config file, with the store's secret
                // as the key's passphrase when the config key is encrypted.
                auth: SshAuth::PrivateKey {
                    key_path: resolved.identity_file,
                    passphrase: secret.filter(|value| !value.is_empty()),
                },
            })
        }
    }
}

/// The pieces of one ~/.ssh/config alias this app consumes.
#[derive(Debug)]
pub struct ResolvedSshAlias {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub identity_file: String,
}

/// Parse the user's ~/.ssh/config for one alias. A hand-rolled reader of the
/// small subset the feature needs (Host / HostName / Port / User /
/// IdentityFile, first-match-wins per ssh_config semantics, `Host *` ignored
/// as a fallback-only pattern). Jump chains arrive with the config's
/// ProxyJump through a later russh-config integration; recorded as a
/// follow-up in the design deviations.
pub fn resolve_ssh_config_alias(alias: &str) -> AppResult<ResolvedSshAlias> {
    let config_path = dirs::home_dir()
        .ok_or_else(|| AppError::storage("Unable to locate the home directory."))?
        .join(".ssh")
        .join("config");
    let text = std::fs::read_to_string(&config_path).map_err(|error| {
        AppError::validation(format!(
            "Could not read {}: {error}. ssh-config auth needs an ssh config file with a \"Host {alias}\" entry.",
            config_path.display()
        ))
    })?;

    let mut matched: Option<ResolvedSshAlias> = None;
    let mut in_block = false;
    let mut host = String::new();
    let mut port: u16 = 22;
    let mut username = String::new();
    let mut identity = String::new();
    let mut saw_identity = false;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = match line.split_once('=') {
            Some((key, value)) => (key.trim(), value.trim()),
            None => match line.split_once(char::is_whitespace) {
                Some((key, value)) => (key.trim(), value.trim()),
                None => continue,
            },
        };
        match key.to_ascii_lowercase().as_str() {
            "host" => {
                // Start of a new block. An earlier match wins (ssh_config
                // first-obtained-value semantics).
                if matched.is_none() && in_block {
                    matched = Some(ResolvedSshAlias {
                        host: if host.is_empty() {
                            alias.to_string()
                        } else {
                            host.clone()
                        },
                        port,
                        username: if username.is_empty() {
                            default_ssh_user()
                        } else {
                            username.clone()
                        },
                        identity_file: if saw_identity {
                            identity.clone()
                        } else {
                            default_identity_file()
                        },
                    });
                }
                in_block = value
                    .split_whitespace()
                    .any(|pattern| pattern.eq_ignore_ascii_case(alias));
                host.clear();
                port = 22;
                username.clear();
                identity.clear();
                saw_identity = false;
            }
            _ if in_block => match key.to_ascii_lowercase().as_str() {
                "hostname" => host = value.to_string(),
                "port" => port = value.parse().unwrap_or(22),
                "user" => username = value.to_string(),
                "identityfile" => {
                    identity = expand_tilde(value);
                    saw_identity = true;
                }
                _ => {}
            },
            _ => {}
        }
    }
    // The final block, if it matched and nothing before it did.
    if matched.is_none() && in_block {
        matched = Some(ResolvedSshAlias {
            host: if host.is_empty() {
                alias.to_string()
            } else {
                host
            },
            port,
            username: if username.is_empty() {
                default_ssh_user()
            } else {
                username
            },
            identity_file: if saw_identity {
                identity
            } else {
                default_identity_file()
            },
        });
    }

    matched.ok_or_else(|| {
        AppError::validation(format!(
            "No \"Host {alias}\" block in your ssh config. Add one (HostName/User/IdentityFile) or pick password/private-key auth."
        ))
    })
}

fn default_ssh_user() -> String {
    std::env::var("USER").unwrap_or_else(|_| "root".to_string())
}

fn default_identity_file() -> String {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("id_ed25519").display().to_string())
        .unwrap_or_else(|| "~/.ssh/id_ed25519".to_string())
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).display().to_string();
        }
    }
    path.to_string()
}

/// Authenticate and connect, dispatching on the resolved auth variant.
async fn connect_ssh(endpoint: &SshEndpoint) -> AppResult<russh::client::Handle<AcceptAnyHostKey>> {
    let config = Arc::new(russh::client::Config::default());
    let mut session = russh::client::connect(
        config,
        (endpoint.host.as_str(), endpoint.port),
        AcceptAnyHostKey,
    )
    .await
    .map_err(|error| {
        AppError::validation(format!(
            "SSH connect to {}:{} failed: {error}",
            endpoint.host, endpoint.port
        ))
    })?;

    let auth = match &endpoint.auth {
        SshAuth::Password { secret } => session
            .authenticate_password(&endpoint.username, secret)
            .await
            .map_err(|error| AppError::validation(format!("SSH auth failed: {error}")))?,
        SshAuth::PrivateKey {
            key_path,
            passphrase,
        } => {
            let key = russh::keys::load_secret_key(key_path, passphrase.as_deref())
                .map_err(|error| {
                    AppError::validation(format!(
                        "Could not load the private key at {key_path}: {error}. Check the path and passphrase."
                    ))
                })?;
            session
                .authenticate_publickey(
                    &endpoint.username,
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), None),
                )
                .await
                .map_err(|error| AppError::validation(format!("SSH key auth failed: {error}")))?
        }
    };
    if auth != russh::client::AuthResult::Success {
        return Err(AppError::validation(match &endpoint.auth {
            SshAuth::Password { .. } => {
                "SSH authentication was rejected. Check the user name and saved password."
            }
            SshAuth::PrivateKey { key_path, .. } => {
                return Err(AppError::validation(format!(
                    "SSH key authentication was rejected for {key_path}. Is this key authorized on the server?"
                )));
            }
        }));
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

/// Resolve a connection's route: the address a driver must dial, plus the
/// forward that makes it reachable (`None` when the connection goes straight
/// to the database).
///
/// When the connection carries a network profile this opens the local forward
/// and answers with the loopback port it bound. **The caller keeps the
/// forward alive for the duration of the run** — dropping it closes the
/// listener and the SSH session inside it.
pub async fn dial_target_for(
    pool: &sqlx::SqlitePool,
    app: &tauri::AppHandle,
    connection: &crate::models::DbConnection,
) -> AppResult<(DialTarget, Option<LiveForward>)> {
    let Some(profile_id) = &connection.network_profile_id else {
        return Ok((DialTarget::direct(connection), None));
    };
    let profile = dbhub_profile(pool, &connection.account_id, profile_id).await?;
    let secret =
        crate::secrets::read_optional_secret(app, &format!("profile/{profile_id}/password"))
            .unwrap_or(None);
    let forward = open_forward(
        &profile,
        &connection.host,
        connection.port as u16,
        move |_| Ok(secret),
    )
    .await?;
    let target = DialTarget::new("127.0.0.1", forward.port());
    Ok((target, Some(forward)))
}

async fn dbhub_profile(
    pool: &sqlx::SqlitePool,
    account_id: &str,
    profile_id: &str,
) -> AppResult<NetworkProfile> {
    crate::db::dbhub::get_profile(pool, account_id, profile_id)
        .await?
        .ok_or_else(|| AppError::validation("The connection's network profile no longer exists."))
}

/// Probe path for the profile test button: bind + open a relay path to the
/// profile's own host:port. Only proves the local bind and the accept loop —
/// the far-side handshake failure surfaces when a connection actually dials.
pub async fn probe_profile(
    profile: &NetworkProfile,
    resolve_secret: impl FnOnce(&str) -> AppResult<Option<String>>,
) -> AppResult<u16> {
    let (host, port) = transport_target(&profile.transport);
    // probe_forward allows a disabled profile: the test validates the stored
    // configuration, `enabled` only gates real routing.
    let forward = probe_forward(&profile, &host, port, resolve_secret).await?;
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
                private_key_path: None,
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
        assert_eq!(
            transport_target(&ssh.transport),
            ("10.20.30.40".to_string(), 22)
        );

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
            private_key_path: None,
            credentials_saved: false,
        };
        let port = probe_profile(&profile, |_| Ok(None)).await.expect("probe");
        assert!(port > 0);
    }

    #[test]
    fn resolver_routes_password_and_private_key() {
        let endpoint =
            resolve_ssh_endpoint("10.1.2.3", 22, "ops", "password", None, Some("pw".into()))
                .expect("password endpoint");
        assert_eq!(endpoint.host, "10.1.2.3");
        assert!(matches!(endpoint.auth, SshAuth::Password { .. }));

        let endpoint = resolve_ssh_endpoint(
            "10.1.2.3",
            2022,
            "ops",
            "private-key",
            Some("~/.ssh/id_rsa_work"),
            Some("phrase".into()),
        )
        .expect("key endpoint");
        match endpoint.auth {
            SshAuth::PrivateKey {
                key_path,
                passphrase,
            } => {
                assert!(key_path.ends_with("id_rsa_work"));
                assert_eq!(passphrase.as_deref(), Some("phrase"));
            }
            other => panic!("wrong auth: {other:?}"),
        }
        assert_eq!(endpoint.port, 2022);
    }

    #[test]
    fn private_key_without_a_path_is_refused_with_guidance() {
        let error = resolve_ssh_endpoint("10.1.2.3", 22, "ops", "private-key", None, None)
            .expect_err("must refuse");
        assert!(error.message.contains("key file path"));
    }

    #[test]
    fn unknown_auth_method_names_the_supported_set() {
        let error =
            resolve_ssh_endpoint("h", 22, "u", "kerberos", None, None).expect_err("must refuse");
        assert!(error
            .message
            .contains("password, private-key or ssh-config"));
    }

    #[test]
    fn ssh_config_alias_parsing_covers_the_documented_subset() {
        // Real config shape: write a temp HOME with an ssh config and resolve
        // against it. expand_tilde needs HOME, so set it for the parse path.
        let home = std::env::temp_dir().join(format!("dbhub-ssh-cfg-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".ssh")).expect("mkdir");
        std::fs::write(
            home.join(".ssh/config"),
            "# global comment\n\
             Host bastion-prod\n\
             \x20 HostName 10.20.30.40\n\
             \x20 User deploy\n\
             \x20 Port 2200\n\
             \x20 IdentityFile ~/.ssh/id_ed25519_bastion\n\
             \n\
             Host *  # wildcard last, must not match\n\
             \x20 User nobody\n",
        )
        .expect("write config");
        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);

        let resolved = resolve_ssh_config_alias("bastion-prod").expect("resolve alias");
        assert_eq!(resolved.host, "10.20.30.40");
        assert_eq!(resolved.username, "deploy");
        assert_eq!(resolved.port, 2200);
        assert!(resolved.identity_file.ends_with("id_ed25519_bastion"));

        // Missing alias names the file and the fix.
        let error = resolve_ssh_config_alias("no-such-host").expect_err("must refuse");
        assert!(error.message.contains("No \"Host no-such-host\""));

        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        let _ = std::fs::remove_dir_all(home);
    }
}
