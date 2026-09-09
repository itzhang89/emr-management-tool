//! DBHub commands: database connections and network profiles, scoped to the
//! active AWS account.
//!
//! Every command resolves the **active** AWS account first and passes its id
//! down to `db::dbhub` — the WebView never picks the scope, so a stale or
//! forged account id in a request cannot reach another account's rows (DBHub
//! design, "账号绑定"). Passwords arrive only in create/update bodies and go
//! straight to the secrets store; they are never stored in SQLite and never
//! echoed back.

use crate::db::{dbhub, repository};
use crate::error::{AppError, AppResult};
use crate::models::{
    DbCatalogRequest, DbConnection, DbConnectionFlagsRequest, DbConnectionInput, DbConnectionRef,
    DbConnectionUpdateInput, DbTestResult, NetworkProfile, NetworkProfileInput, NetworkProfileRef,
};
use tauri::AppHandle;

/// The account scope every DBHub command runs under. An app with no configured
/// account has no DBHub either — the UI shows the "configure an account"
/// empty state long before this matters.
async fn active_account_id(pool: &sqlx::SqlitePool) -> AppResult<String> {
    repository::active_aws_account(pool)
        .await?
        .map(|account| account.id)
        .ok_or_else(|| {
            AppError::validation("No active AWS account. Configure one in Settings first.")
        })
}

fn connection_secret_key(id: &str) -> String {
    format!("db/{id}/password")
}

fn profile_secret_key(id: &str) -> String {
    format!("profile/{id}/password")
}

/// Mirror the "did we store a secret" flag into the transport JSON so the UI
/// can show a masked hint without the secret ever leaving the Rust process.
fn with_credentials_saved(
    mut transport: crate::models::NetworkTransport,
    saved: bool,
) -> crate::models::NetworkTransport {
    match &mut transport {
        crate::models::NetworkTransport::SshTunnel {
            credentials_saved, ..
        } => {
            *credentials_saved = saved;
        }
        crate::models::NetworkTransport::Socks5 {
            credentials_saved, ..
        } => {
            *credentials_saved = saved;
        }
    }
    transport
}

// --- Connections ------------------------------------------------------------

#[tauri::command]
pub async fn list_db_connections() -> AppResult<Vec<DbConnection>> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    dbhub::list_connections(&pool, &account_id).await
}

#[tauri::command]
pub async fn create_db_connection(
    app: AppHandle,
    request: DbConnectionInput,
) -> AppResult<DbConnection> {
    if request.name.trim().is_empty() {
        return Err(AppError::validation("Connection name is required."));
    }
    if request.host.trim().is_empty() {
        return Err(AppError::validation("Connection host is required."));
    }
    if request.port <= 0 || request.port > 65535 {
        return Err(AppError::validation("Connection port must be 1-65535."));
    }
    if request.username.trim().is_empty() {
        return Err(AppError::validation("Connection username is required."));
    }

    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;

    if let Some(profile_id) = request.network_profile_id.as_deref() {
        if !dbhub::profile_belongs_to_account(&pool, &account_id, profile_id).await? {
            return Err(AppError::validation(
                "Network profile was not found in the active account.",
            ));
        }
    }

    let now = chrono::Utc::now();
    let connection = DbConnection {
        id: uuid::Uuid::new_v4().to_string(),
        account_id: account_id.clone(),
        kind: request.kind,
        name: request.name.trim().to_string(),
        host: request.host.trim().to_string(),
        port: request.port,
        database: request
            .database
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        username: request.username.trim().to_string(),
        network_profile_id: request.network_profile_id,
        show_as_tab: request.show_as_tab,
        enabled_for_ai: request.enabled_for_ai,
        ai_read_only_policy: request
            .ai_read_only_policy
            .unwrap_or(crate::models::DbReadOnlyPolicy::SelectOnly),
        sort_order: request.sort_order.unwrap_or_else(|| 0),
        created_at: now,
        updated_at: now,
    };

    dbhub::insert_connection(&pool, &connection).await?;

    if let Some(password) = request.password.filter(|value| !value.is_empty()) {
        crate::secrets::write_secret(&app, &connection_secret_key(&connection.id), &password)?;
    }

    Ok(connection)
}

#[tauri::command]
pub async fn update_db_connection(
    app: AppHandle,
    mut request: DbConnectionUpdateInput,
) -> AppResult<DbConnection> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;

    // Resolve within the account scope first — a foreign id reads as missing.
    let existing = dbhub::get_connection(&pool, &account_id, &request.id)
        .await?
        .ok_or_else(|| AppError::validation("Connection was not found."))?;

    if let Some(profile_id) = request.network_profile_id.as_deref() {
        if !profile_id.is_empty()
            && !dbhub::profile_belongs_to_account(&pool, &account_id, profile_id).await?
        {
            return Err(AppError::validation(
                "Network profile was not found in the active account.",
            ));
        }
    }

    let password = request.password.take();
    dbhub::update_connection(
        &pool,
        &account_id,
        &request.id,
        &dbhub::ConnectionPatch {
            name: request
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            host: request
                .host
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            port: request.port,
            // `None` keeps the stored value; `Some(None)` clears it.
            database: request
                .database
                .as_deref()
                .map(|value| value.trim())
                .map(|value| if value.is_empty() { None } else { Some(value) }),
            username: request
                .username
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            network_profile_id: request.network_profile_id.as_deref().map(|value| {
                if value.is_empty() {
                    None
                } else {
                    Some(value)
                }
            }),
            show_as_tab: request.show_as_tab,
            enabled_for_ai: request.enabled_for_ai,
            ai_read_only_policy: request.ai_read_only_policy,
            sort_order: request.sort_order,
        },
    )
    .await?;

    if let Some(password) = password {
        crate::secrets::write_optional_secret(
            &app,
            &connection_secret_key(&request.id),
            Some(password.as_str()).filter(|value| !value.is_empty()),
        )?;
    }

    dbhub::get_connection(&pool, &account_id, &request.id)
        .await?
        .map(|connection| {
            let _ = existing; // scope check already ran through get_connection
            connection
        })
        .ok_or_else(|| AppError::validation("Connection was not found."))
}

#[tauri::command]
pub async fn set_db_connection_flags(
    _app: AppHandle,
    request: DbConnectionFlagsRequest,
) -> AppResult<DbConnection> {
    let connection_id = request.connection_id;
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;

    dbhub::update_connection(
        &pool,
        &account_id,
        &connection_id,
        &dbhub::ConnectionPatch {
            name: None,
            host: None,
            port: None,
            database: None,
            username: None,
            network_profile_id: None,
            show_as_tab: request.flags.show_as_tab,
            enabled_for_ai: request.flags.enabled_for_ai,
            ai_read_only_policy: request.flags.ai_read_only_policy,
            sort_order: None,
        },
    )
    .await?;

    dbhub::get_connection(&pool, &account_id, &connection_id)
        .await?
        .ok_or_else(|| AppError::validation("Connection was not found."))
}

#[tauri::command]
pub async fn delete_db_connection(
    app: AppHandle,
    request: DbConnectionRef,
) -> AppResult<Vec<DbConnection>> {
    let connection_id = request.connection_id;
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;

    if dbhub::delete_connection(&pool, &account_id, &connection_id).await? {
        // Best effort: a leaked secret key for a deleted connection is worse
        // than a failed cleanup being reported — but neither should block the
        // row deletion that already happened.
        let _ = crate::secrets::delete_secret(&app, &connection_secret_key(&connection_id));
    }

    dbhub::list_connections(&pool, &account_id).await
}

/// Real connectivity probe: open the wire connection (direct or through the
/// profile's local forward), run `SELECT 1`, read the server version. The
/// password comes from the secrets store; a connection without a stored
/// password tests with an empty one and the driver reports auth failure,
/// which reads clearly. Always answers with a result object rather than an
/// error — a failed test is a *result*, not a command failure.
#[tauri::command]
pub async fn test_db_connection(
    app: AppHandle,
    request: DbConnectionRef,
) -> AppResult<DbTestResult> {
    let connection_id = request.connection_id;
    let started = std::time::Instant::now();
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;

    let connection = dbhub::get_connection(&pool, &account_id, &connection_id)
        .await?
        .ok_or_else(|| AppError::validation("Connection was not found."))?;

    // A profile-routed connection dials through its local forward; the
    // disabled-profile check happens inside the router as well, but the early
    // answer here names the profile instead of surfacing a driver error.
    if let Some(profile_id) = &connection.network_profile_id {
        let profile = dbhub::get_profile(&pool, &account_id, profile_id)
            .await?
            .ok_or_else(|| {
                AppError::validation("The connection's network profile no longer exists.")
            })?;
        if !profile.enabled {
            return Ok(DbTestResult {
                ok: false,
                message: format!(
                    "Network profile \"{}\" is disabled. Enable it before testing.",
                    profile.name
                ),
                latency_ms: started.elapsed().as_millis() as u64,
            });
        }
    }

    // Open the local forward when the profile routes this connection; the
    // driver then dials 127.0.0.1:<forward-port> instead of the literal host.
    let forward = crate::db::dbhub_tunnel::route_for_connection(&pool, &app, &connection).await?;
    let mut routed = connection.clone();
    if let Some((host, port, _)) = forward.as_ref() {
        routed.host = host.clone();
        routed.port = *port as i64;
    }

    let password =
        crate::secrets::read_optional_secret(&app, &connection_secret_key(&connection.id))
            .unwrap_or(None);

    let elapsed = started.elapsed().as_millis() as u64;
    match crate::db::dbhub_driver::test_connection(&routed, password).await {
        Ok(version) => Ok(DbTestResult {
            ok: true,
            message: format!("Connected. Server: {version}"),
            latency_ms: elapsed,
        }),
        Err(error) => Ok(DbTestResult {
            ok: false,
            message: error.message.to_string(),
            latency_ms: elapsed,
        }),
    }
}

// --- Network profiles -------------------------------------------------------

#[tauri::command]
pub async fn list_network_profiles() -> AppResult<Vec<NetworkProfile>> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    dbhub::list_profiles(&pool, &account_id).await
}

#[tauri::command]
pub async fn save_network_profile(
    app: AppHandle,
    request: NetworkProfileInput,
) -> AppResult<NetworkProfile> {
    if request.name.trim().is_empty() {
        return Err(AppError::validation("Profile name is required."));
    }

    let (transport, secret_present) = match &request.transport {
        crate::models::NetworkTransport::SshTunnel { .. }
        | crate::models::NetworkTransport::Socks5 { .. } => {
            // Strip any credentials the WebView might have echoed back into the
            // transport payload — secrets travel in `request.secret` only.
            let mut transport = request.transport.clone();
            match &mut transport {
                crate::models::NetworkTransport::SshTunnel {
                    credentials_saved, ..
                }
                | crate::models::NetworkTransport::Socks5 {
                    credentials_saved, ..
                } => {
                    *credentials_saved = false;
                }
            }
            (
                transport,
                request
                    .secret
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .is_some(),
            )
        }
    };

    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;

    let now = chrono::Utc::now();
    // Create assigns an id; update reuses the given one (scoped upsert reads
    // it back below, so a foreign id cannot be smuggled in).
    let id = match request.id.as_deref().filter(|value| !value.is_empty()) {
        Some(id) => {
            dbhub::get_profile(&pool, &account_id, id)
                .await?
                .ok_or_else(|| AppError::validation("Profile was not found."))?;
            id.to_string()
        }
        None => uuid::Uuid::new_v4().to_string(),
    };

    // A re-save without a new secret must keep the stored one — reflect that
    // in the mirrored flag before persisting.
    let previously_saved = crate::secrets::read_optional_secret(&app, &profile_secret_key(&id))
        .map(|value| value.is_some())
        .unwrap_or(false);

    let profile = NetworkProfile {
        id: id.clone(),
        account_id: account_id.clone(),
        name: request.name.trim().to_string(),
        transport: with_credentials_saved(transport, secret_present || previously_saved),
        enabled: request.enabled,
        created_at: now,
        updated_at: now,
    };

    dbhub::upsert_profile(&pool, &profile).await?;

    if let Some(secret) = request.secret.as_deref().filter(|value| !value.is_empty()) {
        crate::secrets::write_secret(&app, &profile_secret_key(&id), secret)?;
    }

    dbhub::get_profile(&pool, &account_id, &id)
        .await?
        .ok_or_else(|| AppError::validation("Profile was not found."))
}

#[tauri::command]
pub async fn delete_network_profile(request: NetworkProfileRef) -> AppResult<()> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;

    // A profile still bound to connections cannot be deleted: the UI prompts
    // the user to unbind first, and this guard is the backstop that keeps a
    // call from any path (or a stale UI) from silently leaving connections
    // direct.
    let referencing =
        dbhub::list_referencing_connections(&pool, &account_id, &request.profile_id).await?;
    if !referencing.is_empty() {
        let names = referencing
            .iter()
            .map(|connection| format!("\"{}\"", connection.name))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(AppError::validation(format!(
            "This profile is still bound to {} connection(s): {names}. \
             Edit those connections and pick '(None — direct connection)' before deleting the profile.",
            referencing.len()
        )));
    }

    dbhub::delete_profile(&pool, &account_id, &request.profile_id).await?;
    Ok(())
}

/// Profile test button: bind a local forward through this profile's
/// transport. This proves the local bind and accept loop are sound; the
/// far-side SSH/SOCKS handshake surfaces when a connection actually dials
/// (the honest scope of a configuration-only probe — recorded in the design).
///
/// A *disabled* profile can still be tested: `enabled` gates whether real
/// connections may route through the profile, not whether its configuration
/// can be validated. Refusing tests on disabled profiles made the button lie
/// ("disabled" forever) whenever the user had not applied the toggle — the
/// test now validates the configuration as stored.
#[tauri::command]
pub async fn test_network_profile(
    app: AppHandle,
    request: NetworkProfileRef,
) -> AppResult<DbTestResult> {
    let profile_id = request.profile_id;
    let started = std::time::Instant::now();
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;

    let profile = dbhub::get_profile(&pool, &account_id, &profile_id)
        .await?
        .ok_or_else(|| AppError::validation("Profile was not found."))?;

    let secret = crate::secrets::read_optional_secret(&app, &profile_secret_key(&profile_id))
        .unwrap_or(None);
    match crate::db::dbhub_tunnel::probe_profile(&profile, move |_| Ok(secret)).await {
        Ok(port) => {
            let (host, port_target) = match &profile.transport {
                crate::models::NetworkTransport::SshTunnel { host, port, .. } => {
                    (host.clone(), *port)
                }
                crate::models::NetworkTransport::Socks5 { host, port, .. } => (host.clone(), *port),
            };
            let enabled_note = if profile.enabled {
                String::new()
            } else {
                " Note: the profile is disabled — enable and apply it before routing connections through it.".to_string()
            };
            Ok(DbTestResult {
                ok: true,
                message: format!(
                    "Local forward bound on 127.0.0.1:{port} (target {host}:{port_target}). Far-side handshake is exercised when a connection dials.{enabled_note}"
                ),
                latency_ms: started.elapsed().as_millis() as u64,
            })
        }
        Err(error) => Ok(DbTestResult {
            ok: false,
            message: error.message.to_string(),
            latency_ms: started.elapsed().as_millis() as u64,
        }),
    }
}

// --- Read-only query execution (workspace + AI tools) ------------------------

/// Run one read-only statement for the human query tab. The AI-tool twin
/// (requireAiEnabled) lives in the MCP layer and reuses the same execution
/// path; both audit via their own layers.
#[tauri::command]
pub async fn run_db_query(
    app: AppHandle,
    request: crate::models::DbQueryRequest,
) -> AppResult<crate::db::dbhub_query::DbQueryResult> {
    crate::db::dbhub_query::run_for_command(
        &app,
        &request.connection_id,
        false,
        &request.sql,
        request.max_rows,
    )
    .await
}

#[tauri::command]
pub async fn list_db_databases(
    app: AppHandle,
    request: DbConnectionRef,
) -> AppResult<Vec<crate::db::dbhub_query::DbCatalogEntry>> {
    crate::db::dbhub_query::catalog_databases_for_command(&app, &request.connection_id).await
}

#[tauri::command]
pub async fn list_db_tables(
    app: AppHandle,
    request: DbCatalogRequest,
) -> AppResult<Vec<crate::db::dbhub_query::DbCatalogEntry>> {
    crate::db::dbhub_query::catalog_tables_for_command(
        &app,
        &request.connection_id,
        &request.database,
    )
    .await
}
