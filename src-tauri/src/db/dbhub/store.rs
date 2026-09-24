//! DBHub persistence: database connections and network profiles.
//!
//! Both tables are **account-bound** — every row carries the `account_id` of
//! the AWS account it belongs to, and every query takes the account as its
//! scope (DBHub design, "账号绑定"). Switching the active AWS account swaps the
//! whole visible set; rows of other accounts are unreachable through these
//! functions because every read/write goes through an account-scoped call.
//!
//! Secrets (connection passwords, SSH passphrases) never live here — they go
//! to the keychain/store under `db/{id}/password` and
//! `profile/{id}/password`; only the `credentials_saved` flag is mirrored in
//! the transport JSON.

use crate::error::{AppError, AppResult};
use crate::models::{
    DbConnection, DbConnectionKind, DbReadOnlyPolicy, GateActor, GateOverrides, GateRefusal,
    NetworkProfile, NetworkTransport, StatementTier,
};
use sqlx::{Row, SqlitePool};

pub(crate) async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    for statement in [
        "create table if not exists db_connections (
            id text primary key,
            account_id text not null,
            kind text not null,
            name text not null,
            host text not null,
            port integer not null,
            database text,
            username text not null,
            network_profile_id text,
            show_as_tab integer not null default 0,
            enabled_for_ai integer not null default 1,
            allow_writes integer not null default 0,
            ai_read_only_policy text not null default 'observer',
            gate_overrides_json text not null default '{}',
            auth_mode text not null default 'manual',
            secret_arn text,
            secret_name text,
            sort_order integer not null default 0,
            created_at text not null,
            updated_at text not null
        )",
        "create table if not exists network_profiles (
            id text primary key,
            account_id text not null,
            name text not null,
            kind text not null,
            transport_json text not null,
            enabled integer not null default 0,
            created_at text not null,
            updated_at text not null
        )",
        "create table if not exists db_catalog_cache (
            connection_id text not null,
            level text not null,
            database_name text not null default '',
            schema_name text not null default '',
            kinds text not null default '',
            payload text not null,
            refreshed_at text not null,
            primary key (connection_id, level, database_name, schema_name, kinds)
        )",
        "create table if not exists db_gate_refusals (
            connection_id text not null,
            statement_key text not null,
            sql text not null,
            tier text not null,
            matched text not null,
            actor text not null,
            hits integer not null default 1,
            last_at text not null,
            primary key (connection_id, statement_key)
        )",
        "create index if not exists idx_db_connections_account on db_connections(account_id, sort_order)",
        "create index if not exists idx_network_profiles_account on network_profiles(account_id)",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    // Columns added after the table shipped. `create table if not exists`
    // leaves an existing database exactly as it was, so a column that arrives
    // later arrives here or not at all.
    for (column, definition) in [
        (
            "allow_writes",
            "alter table db_connections add column allow_writes integer not null default 0",
        ),
        (
            "auth_mode",
            "alter table db_connections add column auth_mode text not null default 'manual'",
        ),
        (
            "secret_arn",
            "alter table db_connections add column secret_arn text",
        ),
        (
            "secret_name",
            "alter table db_connections add column secret_name text",
        ),
        (
            "gate_overrides_json",
            "alter table db_connections add column gate_overrides_json text not null default '{}'",
        ),
    ] {
        if !connection_column_exists(pool, column).await? {
            sqlx::query(definition)
                .execute(pool)
                .await
                .map_err(|error| AppError::storage(error.to_string()))?;
        }
    }
    Ok(())
}

/// Whether `db_connections` already has a column — the guard that keeps the
/// `alter table` above from failing on a database that already ran it.
async fn connection_column_exists(pool: &SqlitePool, column: &str) -> AppResult<bool> {
    let columns = sqlx::query("pragma table_info(db_connections)")
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(columns
        .iter()
        .any(|row| row.get::<String, _>("name") == column))
}

// --- Connections ------------------------------------------------------------

fn kind_column(kind: DbConnectionKind) -> &'static str {
    kind.as_str()
}

fn kind_from_column(value: &str) -> AppResult<DbConnectionKind> {
    match value {
        "mysql" => Ok(DbConnectionKind::Mysql),
        "postgres" => Ok(DbConnectionKind::Postgres),
        "yellowbrick" => Ok(DbConnectionKind::Yellowbrick),
        other => Err(AppError::storage(format!(
            "Unknown connection kind in database: {other}"
        ))),
    }
}

/// The AI mode a stored value means.
///
/// Never fails, and never guesses upward. `select-only` is the value every row
/// written before the modes existed carries, and it means what `observer` means
/// now. Anything else unrecognised — a corrupt value, or one written by a newer
/// version — reads as `observer` too: the strictest mode is the only safe guess,
/// and refusing to load the connection at all would be worse than loading it
/// read-only, which is where it already was.
fn policy_from_column(value: &str) -> DbReadOnlyPolicy {
    match value {
        "confirm" => DbReadOnlyPolicy::Confirm,
        "free" => DbReadOnlyPolicy::Free,
        "observer" | "select-only" => DbReadOnlyPolicy::Observer,
        _ => DbReadOnlyPolicy::Observer,
    }
}

/// The AI mode to write. Always the current spelling, so a legacy row is
/// upgraded the first time anything about the connection is saved.
fn policy_column(policy: DbReadOnlyPolicy) -> &'static str {
    policy.as_str()
}

/// A connection's own changes to the ladder, as stored.
///
/// Stored as an object keyed by verb or routine name. Reading is forgiving in
/// the same direction the modes are: a value that will not parse, or a tier
/// this version does not know, yields no overrides at all rather than an error.
/// An override can only ever loosen, so dropping one leaves the statement on
/// the default ladder — which is the safe place to be wrong, and the only place
/// a corrupt row could not be used to widen anything.
fn overrides_from_column(value: &str) -> GateOverrides {
    serde_json::from_str::<GateOverrides>(value).unwrap_or_default()
}

fn overrides_column(overrides: &GateOverrides) -> String {
    serde_json::to_string(overrides).unwrap_or_else(|_| "{}".to_string())
}

// --- Refusals ---------------------------------------------------------------
//
// What the gate turned away, so the rules editor can offer a key to write
// instead of assuming the reader already knows what one looks like. Capped per
// connection: this is a hint about what to configure, not a ledger.

/// How many refusals one connection keeps. Enough to see a pattern, few enough
/// that the list stays a list.
const MAX_REFUSALS_PER_CONNECTION: i64 = 50;

/// Record one refusal: count it if this statement shape has been refused before,
/// otherwise start a row.
///
/// Grouped by the *masked, uppercased* statement, so the same statement run with
/// different literals is one row with a count. The count is the point — a
/// statement refused fourteen times is a rule somebody is waiting for, and
/// fourteen rows saying the same thing is a list nobody reads.
pub async fn record_refusal(
    pool: &SqlitePool,
    connection_id: &str,
    sql: &str,
    tier: StatementTier,
    matched: &str,
    actor: GateActor,
) -> AppResult<()> {
    let masked = crate::db::dbhub::gate::masked_statement(sql);
    let key = masked.to_ascii_uppercase();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "insert into db_gate_refusals
            (connection_id, statement_key, sql, tier, matched, actor, hits, last_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
         on conflict (connection_id, statement_key) do update set
            hits = hits + 1,
            last_at = excluded.last_at,
            actor = excluded.actor,
            matched = excluded.matched",
    )
    .bind(connection_id)
    .bind(&key)
    .bind(&masked)
    .bind(tier_json(tier))
    .bind(matched)
    .bind(actor.as_str())
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    // Keep the newest, drop the rest. Ordered by `last_at` because that is what
    // the reader sorts by, so what survives is what it would have shown.
    sqlx::query(
        "delete from db_gate_refusals
          where connection_id = ?1
            and statement_key not in (
                select statement_key from db_gate_refusals
                 where connection_id = ?1
                 order by last_at desc
                 limit ?2
            )",
    )
    .bind(connection_id)
    .bind(MAX_REFUSALS_PER_CONNECTION)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(())
}

/// The most recently refused statements on a connection, most recent first.
pub async fn recent_refusals(
    pool: &SqlitePool,
    connection_id: &str,
    limit: i64,
) -> AppResult<Vec<GateRefusal>> {
    let rows = sqlx::query(
        "select * from db_gate_refusals
          where connection_id = ?1
          order by last_at desc
          limit ?2",
    )
    .bind(connection_id)
    .bind(limit.clamp(1, MAX_REFUSALS_PER_CONNECTION))
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(rows.into_iter().map(refusal_from_row).collect())
}

/// Forget a connection's refusals — what the editor's "ignore" does for one
/// entry, and what deleting the connection does for all of them.
pub async fn clear_refusals(pool: &SqlitePool, connection_id: &str) -> AppResult<()> {
    sqlx::query("delete from db_gate_refusals where connection_id = ?1")
        .bind(connection_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Forget one statement's refusals.
pub async fn clear_refusal(
    pool: &SqlitePool,
    connection_id: &str,
    statement_key: &str,
) -> AppResult<()> {
    sqlx::query("delete from db_gate_refusals where connection_id = ?1 and statement_key = ?2")
        .bind(connection_id)
        .bind(statement_key)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

fn refusal_from_row(row: sqlx::sqlite::SqliteRow) -> GateRefusal {
    GateRefusal {
        statement_key: row.get("statement_key"),
        sql: row.get("sql"),
        // A tier this version does not know reads as the strictest, which is the
        // same direction every other defensive read here goes.
        tier: tier_from_json(&row.get::<String, _>("tier")),
        matched: row.get("matched"),
        actor: GateActor::parse(&row.get::<String, _>("actor")),
        hits: row.get::<i64, _>("hits"),
        last_at: crate::db::parse_timestamp(&row.get::<String, _>("last_at")),
    }
}

fn tier_json(tier: StatementTier) -> &'static str {
    match tier {
        StatementTier::Free => "free",
        StatementTier::Confirm => "confirm",
        StatementTier::Refuse => "refuse",
    }
}

fn tier_from_json(value: &str) -> StatementTier {
    match value {
        "free" => StatementTier::Free,
        "confirm" => StatementTier::Confirm,
        _ => StatementTier::Refuse,
    }
}

fn connection_from_row(row: sqlx::sqlite::SqliteRow) -> AppResult<DbConnection> {
    Ok(DbConnection {
        id: row.get("id"),
        account_id: row.get("account_id"),
        kind: kind_from_column(&row.get::<String, _>("kind"))?,
        name: row.get("name"),
        host: row.get("host"),
        port: row.get::<i64, _>("port"),
        database: row.get("database"),
        username: row.get("username"),
        network_profile_id: row.get("network_profile_id"),
        show_as_tab: row.get::<i64, _>("show_as_tab") != 0,
        enabled_for_ai: row.get::<i64, _>("enabled_for_ai") != 0,
        allow_writes: row.get::<i64, _>("allow_writes") != 0,
        ai_read_only_policy: policy_from_column(&row.get::<String, _>("ai_read_only_policy")),
        gate_overrides: overrides_from_column(&row.get::<String, _>("gate_overrides_json")),
        auth_mode: crate::models::DbAuthMode::parse(&row.get::<String, _>("auth_mode"))
            .map_err(AppError::storage)?,
        secret_arn: row.get("secret_arn"),
        secret_name: row.get("secret_name"),
        sort_order: row.get::<i64, _>("sort_order"),
        created_at: crate::db::parse_timestamp(&row.get::<String, _>("created_at")),
        updated_at: crate::db::parse_timestamp(&row.get::<String, _>("updated_at")),
    })
}

/// List the account's connections in tab order.
pub async fn list_connections(pool: &SqlitePool, account_id: &str) -> AppResult<Vec<DbConnection>> {
    let rows = sqlx::query(
        "select * from db_connections where account_id = ?1 order by sort_order, created_at",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter().map(connection_from_row).collect()
}

/// One connection, only if it belongs to `account_id`. Every command that
/// mutates a connection resolves it through this first, so an id from another
/// account is indistinguishable from a missing one.
pub async fn get_connection(
    pool: &SqlitePool,
    account_id: &str,
    id: &str,
) -> AppResult<Option<DbConnection>> {
    let row = sqlx::query("select * from db_connections where id = ?1 and account_id = ?2")
        .bind(id)
        .bind(account_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    row.map(connection_from_row).transpose()
}

/// Insert a connection row. `id` is assigned by the caller.
pub async fn insert_connection(pool: &SqlitePool, connection: &DbConnection) -> AppResult<()> {
    sqlx::query(
        "insert into db_connections
            (id, account_id, kind, name, host, port, database, username, network_profile_id,
             show_as_tab, enabled_for_ai, ai_read_only_policy, allow_writes, gate_overrides_json,
             auth_mode, secret_arn, secret_name,
             sort_order, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19)",
    )
    .bind(&connection.id)
    .bind(&connection.account_id)
    .bind(kind_column(connection.kind))
    .bind(&connection.name)
    .bind(&connection.host)
    .bind(connection.port)
    .bind(&connection.database)
    .bind(&connection.username)
    .bind(&connection.network_profile_id)
    .bind(connection.show_as_tab as i64)
    .bind(connection.enabled_for_ai as i64)
    .bind(policy_column(connection.ai_read_only_policy))
    .bind(connection.allow_writes as i64)
    .bind(overrides_column(&connection.gate_overrides))
    .bind(connection.auth_mode.as_str())
    .bind(&connection.secret_arn)
    .bind(&connection.secret_name)
    .bind(connection.sort_order)
    .bind(connection.created_at.to_rfc3339())
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

// --- Catalog cache ----------------------------------------------------------
//
// What the tree shows, kept so opening it is a SQLite read rather than a round
// trip to the database. Keyed by connection and by level, because the levels
// go stale independently: a new table does not invalidate the list of
// databases.
//
// Nothing here decides *when* to trust an entry — that lives with the callers,
// which are the only ones that know whether the user asked for a refresh.

/// One cached level: the entries as JSON, and when they were read.
pub async fn read_catalog_cache(
    pool: &SqlitePool,
    connection_id: &str,
    level: &str,
    database: &str,
    schema: &str,
    kinds: &str,
) -> AppResult<Option<(String, String)>> {
    let row = sqlx::query(
        "select payload, refreshed_at from db_catalog_cache
         where connection_id = ?1 and level = ?2 and database_name = ?3
           and schema_name = ?4 and kinds = ?5",
    )
    .bind(connection_id)
    .bind(level)
    .bind(database)
    .bind(schema)
    .bind(kinds)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(row.map(|row| {
        (
            row.get::<String, _>("payload"),
            row.get::<String, _>("refreshed_at"),
        )
    }))
}

pub async fn write_catalog_cache(
    pool: &SqlitePool,
    connection_id: &str,
    level: &str,
    database: &str,
    schema: &str,
    kinds: &str,
    payload: &str,
) -> AppResult<()> {
    sqlx::query(
        "insert into db_catalog_cache
            (connection_id, level, database_name, schema_name, kinds, payload, refreshed_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         on conflict (connection_id, level, database_name, schema_name, kinds)
         do update set payload = excluded.payload, refreshed_at = excluded.refreshed_at",
    )
    .bind(connection_id)
    .bind(level)
    .bind(database)
    .bind(schema)
    .bind(kinds)
    .bind(payload)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Drop every level cached for one connection — the whole tree, because a
/// statement that changed the schema can have changed any part of it.
pub async fn clear_catalog_cache(pool: &SqlitePool, connection_id: &str) -> AppResult<()> {
    sqlx::query("delete from db_catalog_cache where connection_id = ?1")
        .bind(connection_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Persisted field updates for `update_connection`. Each present field runs
/// its own statement through the `update_column!` macro (compile-time `concat!`
/// — sqlx 0.9 rejects dynamically built SQL strings), so absent fields are
/// untouched rather than nulled.
///
/// `Default` is every field absent, which is how a caller names only the one
/// thing it means to change.
#[derive(Default)]
pub struct ConnectionPatch<'a> {
    pub name: Option<&'a str>,
    pub host: Option<&'a str>,
    pub port: Option<i64>,
    pub database: Option<Option<&'a str>>,
    pub username: Option<&'a str>,
    pub network_profile_id: Option<Option<&'a str>>,
    pub show_as_tab: Option<bool>,
    pub enabled_for_ai: Option<bool>,
    pub ai_read_only_policy: Option<DbReadOnlyPolicy>,
    pub allow_writes: Option<bool>,
    pub gate_overrides: Option<GateOverrides>,
    pub auth_mode: Option<crate::models::DbAuthMode>,
    pub secret_arn: Option<Option<&'a str>>,
    pub secret_name: Option<Option<&'a str>>,
    pub sort_order: Option<i64>,
}

macro_rules! update_column {
    ($pool:expr, $id:expr, $account_id:expr, $column:literal, $value:expr) => {{
        let affected = sqlx::query(concat!(
            "update db_connections set ",
            $column,
            " = ?1, updated_at = ?3 where id = ?2 and account_id = ?4"
        ))
        .bind(&$value)
        .bind($id)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind($account_id)
        .execute($pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .rows_affected();
        if affected == 0 {
            Err(AppError::validation(format!(
                "Connection {} was not found.",
                $id
            )))
        } else {
            Ok(())
        }
    }};
}

pub async fn update_connection(
    pool: &SqlitePool,
    account_id: &str,
    id: &str,
    patch: &ConnectionPatch<'_>,
) -> AppResult<()> {
    if let Some(value) = patch.name {
        update_column!(pool, id, account_id, "name", value.to_string())?;
    }
    if let Some(value) = patch.host {
        update_column!(pool, id, account_id, "host", value.to_string())?;
    }
    if let Some(value) = patch.port {
        update_column!(pool, id, account_id, "port", value)?;
    }
    if let Some(value) = patch.database {
        update_column!(
            pool,
            id,
            account_id,
            "database",
            value.map(|s| s.to_string())
        )?;
    }
    if let Some(value) = patch.username {
        update_column!(pool, id, account_id, "username", value.to_string())?;
    }
    if let Some(value) = patch.network_profile_id {
        update_column!(
            pool,
            id,
            account_id,
            "network_profile_id",
            value.map(|s| s.to_string())
        )?;
    }
    if let Some(value) = patch.show_as_tab {
        update_column!(pool, id, account_id, "show_as_tab", i64::from(value))?;
    }
    if let Some(value) = patch.allow_writes {
        update_column!(pool, id, account_id, "allow_writes", i64::from(value))?;
    }
    if let Some(value) = patch.gate_overrides.as_ref() {
        update_column!(
            pool,
            id,
            account_id,
            "gate_overrides_json",
            overrides_column(value)
        )?;
    }
    if let Some(value) = patch.enabled_for_ai {
        update_column!(pool, id, account_id, "enabled_for_ai", i64::from(value))?;
    }
    if let Some(value) = patch.ai_read_only_policy {
        update_column!(
            pool,
            id,
            account_id,
            "ai_read_only_policy",
            value.as_str().to_string()
        )?;
    }
    if let Some(value) = patch.auth_mode {
        update_column!(
            pool,
            id,
            account_id,
            "auth_mode",
            value.as_str().to_string()
        )?;
    }
    if let Some(value) = patch.secret_arn {
        update_column!(
            pool,
            id,
            account_id,
            "secret_arn",
            value.map(|s| s.to_string())
        )?;
    }
    if let Some(value) = patch.secret_name {
        update_column!(
            pool,
            id,
            account_id,
            "secret_name",
            value.map(|s| s.to_string())
        )?;
    }
    if let Some(value) = patch.sort_order {
        update_column!(pool, id, account_id, "sort_order", value)?;
    }
    Ok(())
}

pub async fn delete_connection(pool: &SqlitePool, account_id: &str, id: &str) -> AppResult<bool> {
    // Its cached catalogue goes with it: the id is the cache's key, and a
    // connection re-created under the same id would otherwise open on a tree
    // belonging to its predecessor.
    clear_catalog_cache(pool, id).await?;
    let result = sqlx::query("delete from db_connections where id = ?1 and account_id = ?2")
        .bind(id)
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(result.rows_affected() > 0)
}

/// Whether the profile belongs to the same account as the connection that
/// references it. Called before insert/update, so a connection can never point
/// at another account's profile even though both ids are globally unique.
pub async fn profile_belongs_to_account(
    pool: &SqlitePool,
    account_id: &str,
    profile_id: &str,
) -> AppResult<bool> {
    let row =
        sqlx::query("select 1 as one from network_profiles where id = ?1 and account_id = ?2")
            .bind(profile_id)
            .bind(account_id)
            .fetch_optional(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(row.is_some())
}

// --- Network profiles -------------------------------------------------------

fn transport_json(transport: &NetworkTransport) -> AppResult<String> {
    serde_json::to_string(transport).map_err(|error| AppError::storage(error.to_string()))
}

fn transport_from_json(json: &str) -> AppResult<NetworkTransport> {
    serde_json::from_str(json)
        .map_err(|error| AppError::storage(format!("Corrupt network profile transport: {error}")))
}

fn profile_from_row(row: sqlx::sqlite::SqliteRow) -> AppResult<NetworkProfile> {
    Ok(NetworkProfile {
        id: row.get("id"),
        account_id: row.get("account_id"),
        name: row.get("name"),
        transport: transport_from_json(&row.get::<String, _>("transport_json"))?,
        enabled: row.get::<i64, _>("enabled") != 0,
        created_at: crate::db::parse_timestamp(&row.get::<String, _>("created_at")),
        updated_at: crate::db::parse_timestamp(&row.get::<String, _>("updated_at")),
    })
}

pub async fn list_profiles(pool: &SqlitePool, account_id: &str) -> AppResult<Vec<NetworkProfile>> {
    let rows = sqlx::query(
        "select * from network_profiles where account_id = ?1 order by created_at, name",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter().map(profile_from_row).collect()
}

/// One profile, only if it belongs to `account_id` (same scoping rule as
/// `get_connection`).
pub async fn get_profile(
    pool: &SqlitePool,
    account_id: &str,
    id: &str,
) -> AppResult<Option<NetworkProfile>> {
    let row = sqlx::query("select * from network_profiles where id = ?1 and account_id = ?2")
        .bind(id)
        .bind(account_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    row.map(profile_from_row).transpose()
}

/// Insert or replace a profile row (the Overview panel saves a whole profile
/// form, so a full upsert matches the UI better than a patch API here).
pub async fn upsert_profile(pool: &SqlitePool, profile: &NetworkProfile) -> AppResult<()> {
    sqlx::query(
        "insert into network_profiles (id, account_id, name, kind, transport_json, enabled, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         on conflict(id) do update set
            name = excluded.name,
            kind = excluded.kind,
            transport_json = excluded.transport_json,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at",
    )
    .bind(&profile.id)
    .bind(&profile.account_id)
    .bind(&profile.name)
    .bind(profile.transport.kind())
    .bind(transport_json(&profile.transport)?)
    .bind(profile.enabled as i64)
    .bind(profile.created_at.to_rfc3339())
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// List the account's connections that route through this profile. Used to
/// refuse deleting a profile that is still bound — silently nulling the
/// reference would leave a connection silently direct, which is exactly the
/// surprise the delete guard exists to prevent.
pub async fn list_referencing_connections(
    pool: &SqlitePool,
    account_id: &str,
    profile_id: &str,
) -> AppResult<Vec<DbConnection>> {
    let rows = sqlx::query(
        "select * from db_connections where account_id = ?1 and network_profile_id = ?2 order by name",
    )
    .bind(account_id)
    .bind(profile_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter().map(connection_from_row).collect()
}

/// Delete a profile; connections that referenced it fall back to direct
/// connections (`network_profile_id = null`) rather than dangling.
pub async fn delete_profile(pool: &SqlitePool, account_id: &str, id: &str) -> AppResult<bool> {
    let result = sqlx::query("delete from network_profiles where id = ?1 and account_id = ?2")
        .bind(id)
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    if result.rows_affected() > 0 {
        sqlx::query(
            "update db_connections set network_profile_id = null, updated_at = ?3
             where network_profile_id = ?1 and account_id = ?2",
        )
        .bind(id)
        .bind(account_id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
        return Ok(true);
    }
    Ok(false)
}

// --- Account cascade --------------------------------------------------------

/// Delete everything DBHub stored for one AWS account — its connections and
/// profiles. Called from `delete_aws_account`; returns the connection and
/// profile ids so the caller can clear their secrets entries.
pub async fn delete_all_for_account(
    pool: &SqlitePool,
    account_id: &str,
) -> AppResult<(Vec<String>, Vec<String>)> {
    let connection_rows = sqlx::query("select id from db_connections where account_id = ?1")
        .bind(account_id)
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    let connection_ids: Vec<String> = connection_rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("id").ok())
        .collect();

    let profile_rows = sqlx::query("select id from network_profiles where account_id = ?1")
        .bind(account_id)
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    let profile_ids: Vec<String> = profile_rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("id").ok())
        .collect();

    sqlx::query("delete from db_connections where account_id = ?1")
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query("delete from network_profiles where account_id = ?1")
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    Ok((connection_ids, profile_ids))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::StatementTier;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect");
        migrate(&pool).await.expect("migrate");
        pool
    }

    /// An override map, built the way a caller with an opinion would write it.
    fn overrides(entries: &[(&str, StatementTier)]) -> GateOverrides {
        entries
            .iter()
            .map(|(key, tier)| ((*key).to_string(), *tier))
            .collect()
    }

    fn connection(account_id: &str, id: &str, name: &str) -> DbConnection {
        DbConnection {
            id: id.to_string(),
            account_id: account_id.to_string(),
            kind: DbConnectionKind::Mysql,
            name: name.to_string(),
            host: "10.0.0.1".to_string(),
            port: 3306,
            database: Some("sales".to_string()),
            username: "bi_reader".to_string(),
            network_profile_id: None,
            show_as_tab: true,
            enabled_for_ai: true,
            ai_read_only_policy: DbReadOnlyPolicy::Observer,
            gate_overrides: Default::default(),
            allow_writes: false,
            auth_mode: crate::models::DbAuthMode::Manual,
            secret_arn: None,
            secret_name: None,
            sort_order: 0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    fn profile(account_id: &str, id: &str, name: &str) -> NetworkProfile {
        NetworkProfile {
            id: id.to_string(),
            account_id: account_id.to_string(),
            name: name.to_string(),
            transport: NetworkTransport::SshTunnel {
                host: "10.20.30.40".to_string(),
                port: 22,
                username: "root".to_string(),
                auth_method: "password".to_string(),
                private_key_path: None,
                credentials_saved: false,
            },
            enabled: true,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[tokio::test]
    async fn connections_are_scoped_by_account() {
        let pool = test_pool().await;
        insert_connection(&pool, &connection("acct-a", "c1", "A's MySQL"))
            .await
            .expect("insert a");
        insert_connection(&pool, &connection("acct-b", "c2", "B's MySQL"))
            .await
            .expect("insert b");

        let for_a = list_connections(&pool, "acct-a").await.expect("list a");
        assert_eq!(for_a.len(), 1);
        assert_eq!(for_a[0].name, "A's MySQL");

        // Account-scoped get: A cannot resolve B's connection id — reads like
        // a missing row, which is what every command treats it as.
        assert!(get_connection(&pool, "acct-a", "c2")
            .await
            .unwrap()
            .is_none());
        assert!(get_connection(&pool, "acct-b", "c1")
            .await
            .unwrap()
            .is_none());
        assert!(get_connection(&pool, "acct-a", "c1")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn update_patch_leaves_absent_fields_untouched() {
        let pool = test_pool().await;
        insert_connection(&pool, &connection("acct-a", "c1", "Original"))
            .await
            .expect("insert");

        update_connection(
            &pool,
            "acct-a",
            "c1",
            &ConnectionPatch {
                name: Some("Renamed"),
                host: None,
                port: None,
                database: None,
                username: None,
                network_profile_id: None,
                show_as_tab: None,
                enabled_for_ai: Some(false),
                ai_read_only_policy: None,
                gate_overrides: Default::default(),
                allow_writes: None,
                auth_mode: None,
                secret_arn: None,
                secret_name: None,
                sort_order: None,
            },
        )
        .await
        .expect("update");

        let updated = get_connection(&pool, "acct-a", "c1")
            .await
            .expect("get")
            .expect("exists");
        assert_eq!(updated.name, "Renamed");
        assert!(!updated.enabled_for_ai);
        // Untouched by the patch:
        assert_eq!(updated.host, "10.0.0.1");
        assert_eq!(updated.port, 3306);
        assert_eq!(updated.username, "bi_reader");
        assert!(updated.show_as_tab);
        assert_eq!(updated.ai_read_only_policy, DbReadOnlyPolicy::Observer);
    }

    #[tokio::test]
    async fn update_rejects_foreign_account() {
        let pool = test_pool().await;
        insert_connection(&pool, &connection("acct-a", "c1", "A's"))
            .await
            .expect("insert");

        let error = update_connection(
            &pool,
            "acct-b",
            "c1",
            &ConnectionPatch {
                name: Some("Hijack"),
                host: None,
                port: None,
                database: None,
                username: None,
                network_profile_id: None,
                show_as_tab: None,
                enabled_for_ai: None,
                ai_read_only_policy: None,
                gate_overrides: Default::default(),
                allow_writes: None,
                auth_mode: None,
                secret_arn: None,
                secret_name: None,
                sort_order: None,
            },
        )
        .await
        .expect_err("must not update another account's connection");
        assert!(error.message.contains("not found"));
    }

    #[tokio::test]
    async fn delete_profile_clears_references_in_same_account_only() {
        let pool = test_pool().await;
        let mut conn_a = connection("acct-a", "c1", "uses profile");
        conn_a.network_profile_id = Some("p1".to_string());
        insert_connection(&pool, &conn_a).await.expect("insert a");
        let mut conn_b = connection("acct-b", "c2", "uses same id in other account");
        conn_b.network_profile_id = Some("p1".to_string());
        insert_connection(&pool, &conn_b).await.expect("insert b");
        upsert_profile(&pool, &profile("acct-a", "p1", "A's tunnel"))
            .await
            .expect("upsert");

        // Only A's profile is visible for deletion under A's scope.
        assert!(get_profile(&pool, "acct-b", "p1").await.unwrap().is_none());
        let deleted = delete_profile(&pool, "acct-a", "p1").await.expect("delete");
        assert!(deleted);

        // A's connection fell back to direct; B's untouched (its p1 is its own
        // account's namespace and was not part of this delete).
        let a = get_connection(&pool, "acct-a", "c1")
            .await
            .unwrap()
            .unwrap();
        assert!(a.network_profile_id.is_none());
        let b = get_connection(&pool, "acct-b", "c2")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(b.network_profile_id.as_deref(), Some("p1"));
    }

    #[tokio::test]
    async fn list_referencing_connections_is_account_scoped_and_names_them() {
        let pool = test_pool().await;
        let mut conn_a = connection("acct-a", "c1", "Orders DB");
        conn_a.network_profile_id = Some("p1".to_string());
        insert_connection(&pool, &conn_a).await.expect("insert a");
        let mut conn_a2 = connection("acct-a", "c2", "Warehouse DB");
        conn_a2.network_profile_id = Some("p1".to_string());
        insert_connection(&pool, &conn_a2).await.expect("insert a2");
        let mut conn_b = connection("acct-b", "c3", "Other account DB");
        conn_b.network_profile_id = Some("p1".to_string());
        insert_connection(&pool, &conn_b).await.expect("insert b");

        // Scoped by account, ordered by name.
        let referencing = list_referencing_connections(&pool, "acct-a", "p1")
            .await
            .expect("list");
        let names: Vec<&str> = referencing.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["Orders DB", "Warehouse DB"]);

        // A different account's binding is invisible to A's guard.
        assert!(list_referencing_connections(&pool, "acct-a", "p1")
            .await
            .unwrap()
            .iter()
            .all(|c| c.account_id == "acct-a"));
    }

    #[tokio::test]
    async fn profile_belongs_to_account_gates_cross_account_reference() {
        let pool = test_pool().await;
        upsert_profile(&pool, &profile("acct-a", "p1", "A's tunnel"))
            .await
            .expect("upsert");

        assert!(profile_belongs_to_account(&pool, "acct-a", "p1")
            .await
            .unwrap());
        assert!(!profile_belongs_to_account(&pool, "acct-b", "p1")
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn delete_all_for_account_returns_ids_for_secret_cleanup() {
        let pool = test_pool().await;
        insert_connection(&pool, &connection("acct-a", "c1", "one"))
            .await
            .expect("insert");
        insert_connection(&pool, &connection("acct-a", "c2", "two"))
            .await
            .expect("insert");
        upsert_profile(&pool, &profile("acct-a", "p1", "tunnel"))
            .await
            .expect("upsert");
        insert_connection(&pool, &connection("acct-b", "c3", "other account"))
            .await
            .expect("insert");

        let (connections, profiles) = delete_all_for_account(&pool, "acct-a")
            .await
            .expect("cascade");

        assert_eq!(connections, vec!["c1", "c2"]);
        assert_eq!(profiles, vec!["p1"]);
        assert!(list_connections(&pool, "acct-a").await.unwrap().is_empty());
        assert_eq!(list_connections(&pool, "acct-b").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn connection_roundtrips_kind_and_policy() {
        let pool = test_pool().await;
        let mut yellowbrick = connection("acct-a", "yb1", "YB Prod");
        yellowbrick.kind = DbConnectionKind::Yellowbrick;
        insert_connection(&pool, &yellowbrick)
            .await
            .expect("insert");

        let loaded = get_connection(&pool, "acct-a", "yb1")
            .await
            .unwrap()
            .expect("exists");
        assert_eq!(loaded.kind, DbConnectionKind::Yellowbrick);
        assert_eq!(loaded.ai_read_only_policy, DbReadOnlyPolicy::Observer);
        assert!(!loaded.allow_writes);
    }

    #[tokio::test]
    async fn the_catalog_cache_round_trips_and_clears() {
        let pool = test_pool().await;
        assert!(
            read_catalog_cache(&pool, "c1", "objects", "sales", "", "table")
                .await
                .unwrap()
                .is_none()
        );

        write_catalog_cache(
            &pool,
            "c1",
            "objects",
            "sales",
            "",
            "table",
            "[{\"name\":\"orders\"}]",
        )
        .await
        .expect("write");
        let (payload, refreshed_at) =
            read_catalog_cache(&pool, "c1", "objects", "sales", "", "table")
                .await
                .unwrap()
                .expect("cached");
        assert_eq!(payload, "[{\"name\":\"orders\"}]");
        assert!(!refreshed_at.is_empty());

        // A different question is a different entry — asking for views must
        // not be answered with the tables.
        assert!(
            read_catalog_cache(&pool, "c1", "objects", "sales", "", "table,view")
                .await
                .unwrap()
                .is_none()
        );

        clear_catalog_cache(&pool, "c1").await.expect("clear");
        assert!(
            read_catalog_cache(&pool, "c1", "objects", "sales", "", "table")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn deleting_a_connection_takes_its_cached_catalog_with_it() {
        let pool = test_pool().await;
        insert_connection(&pool, &connection("acct-a", "c1", "Gone"))
            .await
            .expect("insert");
        write_catalog_cache(&pool, "c1", "databases", "", "", "", "[]")
            .await
            .expect("write");

        delete_connection(&pool, "acct-a", "c1")
            .await
            .expect("delete");

        // A connection re-created under the same id must not open on its
        // predecessor's tree.
        assert!(read_catalog_cache(&pool, "c1", "databases", "", "", "")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn allow_writes_survives_a_round_trip() {
        // Its own test because the insert binds this column next to the
        // read-only policy: swapping those two writes one field's value into
        // the other's column, silently, and only an assertion notices.
        let pool = test_pool().await;
        let mut connection = connection("acct-a", "c1", "Writable");
        connection.allow_writes = true;
        connection.ai_read_only_policy = DbReadOnlyPolicy::Observer;
        insert_connection(&pool, &connection).await.expect("insert");

        let loaded = get_connection(&pool, "acct-a", "c1")
            .await
            .unwrap()
            .expect("exists");
        assert!(loaded.allow_writes);
        assert_eq!(loaded.ai_read_only_policy, DbReadOnlyPolicy::Observer);
    }

    #[test]
    fn a_row_written_before_the_modes_still_reads() {
        // Every install that predates the modes has `select-only` in this
        // column. It means what `observer` means now, so it reads as one rather
        // than as an error that would make the connection unopenable.
        assert_eq!(
            policy_from_column("select-only"),
            DbReadOnlyPolicy::Observer
        );
    }

    #[test]
    fn the_modes_round_trip() {
        for mode in [
            DbReadOnlyPolicy::Observer,
            DbReadOnlyPolicy::Confirm,
            DbReadOnlyPolicy::Free,
        ] {
            assert_eq!(policy_from_column(policy_column(mode)), mode);
        }
    }

    #[test]
    fn an_unrecognised_mode_reads_as_the_strictest_one() {
        // Not an error, and never a widening: a value this version does not
        // know — corrupt, or written by a newer one — must not grant more than
        // the default. Refusing to load the connection would be worse than
        // loading it read-only, which is where it already was.
        assert_eq!(
            policy_from_column("writes-everything"),
            DbReadOnlyPolicy::Observer
        );
        assert_eq!(policy_from_column(""), DbReadOnlyPolicy::Observer);
    }

    #[test]
    fn overrides_read_forgivingly() {
        // The same direction as the modes: an override can only ever loosen, so
        // dropping one leaves the statement on the default ladder. A row that
        // will not parse must not be readable as a widening, and must not stop
        // the connection loading either.
        for broken in ["", "not json", "[]", "{\"TRUNCATE\": \"nonsense\"}"] {
            assert!(
                overrides_from_column(broken).is_empty(),
                "should read as no overrides: {broken}"
            );
        }
        // A good map survives.
        let stored = overrides_column(&overrides(&[("TRUNCATE", StatementTier::Confirm)]));
        assert_eq!(
            overrides_from_column(&stored),
            overrides(&[("TRUNCATE", StatementTier::Confirm)])
        );
    }

    #[tokio::test]
    async fn overrides_round_trip_through_a_connection_row() {
        let pool = test_pool().await;
        let mut saved = connection("acct-a", "c1", "Sales");
        saved.gate_overrides = overrides(&[
            ("TRUNCATE", StatementTier::Confirm),
            ("sp_rebuild_index", StatementTier::Free),
        ]);
        insert_connection(&pool, &saved).await.expect("insert");

        let loaded = get_connection(&pool, "acct-a", "c1")
            .await
            .unwrap()
            .expect("exists");
        assert_eq!(loaded.gate_overrides, saved.gate_overrides);

        // And a connection saved without any carries an empty map, which is
        // what every connection that predates them reads as.
        insert_connection(&pool, &connection("acct-a", "c2", "Plain"))
            .await
            .expect("insert");
        let plain = get_connection(&pool, "acct-a", "c2")
            .await
            .unwrap()
            .expect("exists");
        assert!(plain.gate_overrides.is_empty());
    }

    #[tokio::test]
    async fn the_flags_patch_replaces_overrides_and_an_empty_map_clears_them() {
        let pool = test_pool().await;
        let mut saved = connection("acct-a", "c1", "Sales");
        saved.gate_overrides = overrides(&[("TRUNCATE", StatementTier::Confirm)]);
        insert_connection(&pool, &saved).await.expect("insert");

        // A patch that says nothing about them leaves them where they are.
        update_connection(
            &pool,
            "acct-a",
            "c1",
            &ConnectionPatch {
                show_as_tab: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("patch");
        let untouched = get_connection(&pool, "acct-a", "c1")
            .await
            .unwrap()
            .expect("exists");
        assert_eq!(untouched.gate_overrides.len(), 1);

        // An explicit empty map is how the UI clears them again.
        update_connection(
            &pool,
            "acct-a",
            "c1",
            &ConnectionPatch {
                gate_overrides: Some(GateOverrides::new()),
                ..Default::default()
            },
        )
        .await
        .expect("patch");
        let cleared = get_connection(&pool, "acct-a", "c1")
            .await
            .unwrap()
            .expect("exists");
        assert!(cleared.gate_overrides.is_empty());
    }

    #[tokio::test]
    async fn a_refusal_is_counted_rather_than_repeated() {
        let pool = test_pool().await;

        // The same statement shape three times with different values: one row,
        // three hits. A wall of near-identical rows is a list nobody reads.
        for id in [3, 99, 412] {
            record_refusal(
                &pool,
                "c1",
                &format!("DELETE FROM orders WHERE id = {id}"),
                StatementTier::Refuse,
                "DELETE without WHERE",
                GateActor::Human,
            )
            .await
            .expect("record");
        }

        let rows = recent_refusals(&pool, "c1", 50).await.expect("read");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].hits, 3);
        assert_eq!(rows[0].matched, "DELETE without WHERE");
        assert_eq!(rows[0].actor, GateActor::Human);
        // Nothing a value could identify survives into what is stored.
        assert_eq!(rows[0].sql, "DELETE FROM orders WHERE id = ?");
        assert!(!rows[0].sql.contains("412"));
    }

    #[tokio::test]
    async fn refusals_are_per_connection_and_newest_first() {
        let pool = test_pool().await;
        record_refusal(
            &pool,
            "c1",
            "DROP TABLE a",
            StatementTier::Refuse,
            "DROP",
            GateActor::Human,
        )
        .await
        .expect("record");
        record_refusal(
            &pool,
            "c2",
            "DROP TABLE b",
            StatementTier::Refuse,
            "DROP",
            GateActor::Ai,
        )
        .await
        .expect("record");
        record_refusal(
            &pool,
            "c1",
            "TRUNCATE c",
            StatementTier::Refuse,
            "TRUNCATE",
            GateActor::Ai,
        )
        .await
        .expect("record");

        let c1 = recent_refusals(&pool, "c1", 50).await.expect("read");
        assert_eq!(c1.len(), 2, "only this connection's");
        assert_eq!(c1[0].sql, "TRUNCATE c", "newest first");
        assert_eq!(c1[1].sql, "DROP TABLE a");
        // The actor is kept, so the editor can say who keeps hitting the wall.
        assert_eq!(c1[0].actor, GateActor::Ai);

        let c2 = recent_refusals(&pool, "c2", 50).await.expect("read");
        assert_eq!(c2.len(), 1);
    }

    #[tokio::test]
    async fn a_connections_refusals_are_capped_and_the_newest_survive() {
        let pool = test_pool().await;
        for index in 0..(MAX_REFUSALS_PER_CONNECTION + 5) {
            record_refusal(
                &pool,
                "c1",
                &format!("DROP TABLE t{index}"),
                StatementTier::Refuse,
                "DROP",
                GateActor::Human,
            )
            .await
            .expect("record");
        }
        let rows = recent_refusals(&pool, "c1", 200).await.expect("read");
        assert_eq!(rows.len() as i64, MAX_REFUSALS_PER_CONNECTION);
        // The most recent one is still here; the first one is gone.
        assert!(rows.iter().any(|row| row.sql.ends_with("t54")));
        assert!(!rows.iter().any(|row| row.sql.ends_with("t0")));
    }

    #[tokio::test]
    async fn a_refusal_can_be_forgotten() {
        let pool = test_pool().await;
        record_refusal(
            &pool,
            "c1",
            "DROP TABLE a",
            StatementTier::Refuse,
            "DROP",
            GateActor::Human,
        )
        .await
        .expect("record");
        let rows = recent_refusals(&pool, "c1", 50).await.expect("read");
        let key = rows[0].statement_key.clone();

        clear_refusal(&pool, "c1", &key).await.expect("clear one");
        assert!(recent_refusals(&pool, "c1", 50)
            .await
            .expect("read")
            .is_empty());

        record_refusal(
            &pool,
            "c1",
            "DROP TABLE a",
            StatementTier::Refuse,
            "DROP",
            GateActor::Human,
        )
        .await
        .expect("record");
        clear_refusals(&pool, "c1").await.expect("clear all");
        assert!(recent_refusals(&pool, "c1", 50)
            .await
            .expect("read")
            .is_empty());
    }

    #[tokio::test]
    async fn migrate_adds_the_write_column_to_an_older_database() {
        // `create table if not exists` leaves an existing database alone, so
        // the column that arrived later has to be added by hand — and this is
        // the path every existing install takes. A pool of its own, because
        // `test_pool` has already migrated.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect");
        sqlx::query(
            "create table db_connections (
                id text primary key,
                account_id text not null,
                kind text not null,
                name text not null,
                host text not null,
                port integer not null,
                database text,
                username text not null,
                network_profile_id text,
                show_as_tab integer not null default 0,
                enabled_for_ai integer not null default 1,
                ai_read_only_policy text not null default 'select-only',
                sort_order integer not null default 0,
                created_at text not null,
                updated_at text not null
            )",
        )
        .execute(&pool)
        .await
        .expect("an older table");

        migrate(&pool).await.expect("migrate");

        let mut connection = connection("acct-a", "c1", "Existing");
        connection.allow_writes = true;
        insert_connection(&pool, &connection).await.expect("insert");
        assert!(
            get_connection(&pool, "acct-a", "c1")
                .await
                .unwrap()
                .expect("exists")
                .allow_writes
        );
    }
}
