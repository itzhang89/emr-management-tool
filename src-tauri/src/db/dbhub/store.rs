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
    DbConnection, DbConnectionKind, DbReadOnlyPolicy, NetworkProfile, NetworkTransport,
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
            ai_read_only_policy text not null default 'select-only',
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
    for (column, definition) in [(
        "allow_writes",
        "alter table db_connections add column allow_writes integer not null default 0",
    )] {
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

fn policy_column(policy: DbReadOnlyPolicy) -> &'static str {
    policy.as_str()
}

fn policy_from_column(value: &str) -> AppResult<DbReadOnlyPolicy> {
    match value {
        "select-only" => Ok(DbReadOnlyPolicy::SelectOnly),
        other => Err(AppError::storage(format!(
            "Unknown read-only policy in database: {other}"
        ))),
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
        ai_read_only_policy: policy_from_column(&row.get::<String, _>("ai_read_only_policy"))?,
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
             show_as_tab, enabled_for_ai, ai_read_only_policy, allow_writes,
             sort_order, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
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
    .bind(connection.sort_order)
    .bind(connection.created_at.to_rfc3339())
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Persisted field updates for `update_connection`. Each present field runs
/// its own statement through the `update_column!` macro (compile-time `concat!`
/// — sqlx 0.9 rejects dynamically built SQL strings), so absent fields are
/// untouched rather than nulled.
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
    if let Some(value) = patch.sort_order {
        update_column!(pool, id, account_id, "sort_order", value)?;
    }
    Ok(())
}

pub async fn delete_connection(pool: &SqlitePool, account_id: &str, id: &str) -> AppResult<bool> {
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
            ai_read_only_policy: DbReadOnlyPolicy::SelectOnly,
            allow_writes: false,
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
                allow_writes: None,
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
        assert_eq!(updated.ai_read_only_policy, DbReadOnlyPolicy::SelectOnly);
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
                allow_writes: None,
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
        assert_eq!(loaded.ai_read_only_policy, DbReadOnlyPolicy::SelectOnly);
        assert!(!loaded.allow_writes);
    }

    #[tokio::test]
    async fn allow_writes_survives_a_round_trip() {
        // Its own test because the insert binds this column next to the
        // read-only policy: swapping those two writes one field's value into
        // the other's column, silently, and only an assertion notices.
        let pool = test_pool().await;
        let mut connection = connection("acct-a", "c1", "Writable");
        connection.allow_writes = true;
        connection.ai_read_only_policy = DbReadOnlyPolicy::SelectOnly;
        insert_connection(&pool, &connection).await.expect("insert");

        let loaded = get_connection(&pool, "acct-a", "c1")
            .await
            .unwrap()
            .expect("exists");
        assert!(loaded.allow_writes);
        assert_eq!(loaded.ai_read_only_policy, DbReadOnlyPolicy::SelectOnly);
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
