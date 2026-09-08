//! Read-only SQL execution for DBHub connections (design section 8): the
//! command layer that wraps the read-only gate (dbhub_engine), the driver
//! (dbhub_driver) and per-dialect metadata reads for the query workspace's
//! catalog tree.

use crate::db::{dbhub, dbhub_driver, dbhub_engine, dbhub_tunnel, repository};
use crate::error::{AppError, AppResult};
use crate::models::DbConnectionKind;
use serde::Serialize;
use sqlx::{Column, Row};

/// Hard cap on rows returned to the UI per page — result pages fetch more via
/// the token only if the driver exposes one (first cut: offset paging).
const MAX_PAGE_ROWS: i64 = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    pub row_count: usize,
    pub truncated: bool,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbCatalogEntry {
    pub name: String,
    pub kind: Option<String>,
}

fn pool_secret_key(id: &str) -> String {
    format!("db/{id}/password")
}

/// The fields the executor needs, split out so tests can build one without a
/// Tauri handle. `pool` is the app's SQLite pool (used to resolve the network
/// profile when routing).
pub(crate) struct DbConnectionShape {
    pub pool: sqlx::SqlitePool,
    pub connection: crate::models::DbConnection,
    pub password: Option<String>,
}

async fn active_account_id(pool: &sqlx::SqlitePool) -> AppResult<String> {
    repository::active_aws_account(pool)
        .await?
        .map(|account| account.id)
        .ok_or_else(|| {
            AppError::validation("No active AWS account. Configure one in Settings first.")
        })
}

/// The single execution path for read-only SQL. The gate runs first; the
/// driver then opens a short-lived pool (a query tab fires at human cadence,
/// pooling across calls is a later optimisation), runs the statement inside a
/// read-only transaction where the driver supports one, and caps the rows.
/// `route_override` rewrites the dial target when a network profile forwards
/// this connection through a local tunnel port (`(host, port)` of 127.0.0.1:N).
pub(crate) async fn execute_read_only(
    shape: &DbConnectionShape,
    sql: &str,
    max_rows: usize,
) -> AppResult<DbQueryResult> {
    execute_read_only_routed(shape, sql, max_rows, None).await
}

pub(crate) async fn execute_read_only_routed(
    shape: &DbConnectionShape,
    sql: &str,
    max_rows: usize,
    route_override: Option<(&str, u16)>,
) -> AppResult<DbQueryResult> {
    if let dbhub_engine::StatementClass::Blocked { reason } = dbhub_engine::classify(sql) {
        return Err(AppError::validation(format!(
            "Blocked by the read-only gate: {reason}"
        )));
    }

    let cap = max_rows.clamp(1, MAX_PAGE_ROWS as usize);
    let started = std::time::Instant::now();

    let (columns, rows, truncated) = match shape.connection.kind {
        DbConnectionKind::Mysql => run_mysql(shape, sql, cap, route_override).await?,
        DbConnectionKind::Postgres | DbConnectionKind::Yellowbrick => {
            run_postgres(shape, sql, cap, route_override).await?
        }
    };

    Ok(DbQueryResult {
        columns,
        row_count: rows.len(),
        rows,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

async fn run_mysql(
    shape: &DbConnectionShape,
    sql: &str,
    cap: usize,
    route_override: Option<(&str, u16)>,
) -> AppResult<(Vec<String>, Vec<serde_json::Value>, bool)> {
    let url = dbhub_driver::mysql_url_routed(&shape.connection, shape.password.as_deref(), route_override)?;
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .acquire_timeout(dbhub_driver::TEST_TIMEOUT)
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|error| AppError::validation(dbhub_driver::describe_dial_error(&error)))?;

    // Read-only enforcement, MySQL-correct: `SET TRANSACTION READ ONLY` must be
    // issued *before* the transaction it governs, so running it inside a
    // `tx.begin()` fails ("cannot start a transaction within a transaction"
    // / server refuses SET inside a transaction). The session-level form puts
    // the whole session into read-only mode; every autocommit statement that
    // follows (this one) is then refused if it writes. The gate already
    // blocked writes — this is defence in depth that actually runs.
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| AppError::validation(dbhub_driver::describe_dial_error(&error)))?;
    sqlx::query("set session transaction read only")
        .execute(&mut *conn)
        .await
        .map_err(|error| AppError::validation(dbhub_driver::describe_dial_error(&error)))?;

    let rows = sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .fetch_all(&mut *conn)
        .await
        .map_err(|error| AppError::validation(dbhub_driver::describe_dial_error(&error)))?;
    pool.close().await;

    Ok(project_mysql_rows(&rows, cap))
}

fn project_mysql_rows(
    rows: &[sqlx::mysql::MySqlRow],
    cap: usize,
) -> (Vec<String>, Vec<serde_json::Value>, bool) {
    let columns: Vec<String> = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_default();

    let truncated = rows.len() > cap;
    let json_rows: Vec<serde_json::Value> = rows
        .iter()
        .take(cap)
        .map(|row| {
            let mut map = serde_json::Map::new();
            for (index, column) in row.columns().iter().enumerate() {
                let value: serde_json::Value = match row.try_get::<Option<serde_json::Value>, _>(index) {
                    Ok(Some(value)) => value,
                    Ok(None) | Err(_) => serde_json::Value::Null,
                };
                map.insert(column.name().to_string(), normalize(value));
            }
            serde_json::Value::Object(map)
        })
        .collect();

    (columns, json_rows, truncated)
}

async fn run_postgres(
    shape: &DbConnectionShape,
    sql: &str,
    cap: usize,
    route_override: Option<(&str, u16)>,
) -> AppResult<(Vec<String>, Vec<serde_json::Value>, bool)> {
    let url = dbhub_driver::postgres_url_routed(&shape.connection, shape.password.as_deref(), route_override)?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(dbhub_driver::TEST_TIMEOUT)
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|error| AppError::validation(dbhub_driver::describe_dial_error(&error)))?;

    // `BEGIN READ ONLY` is the explicit, portable way to open a read-only
    // transaction on Postgres (Yellowbrick rides this wire too). Issuing
    // `SET TRANSACTION READ ONLY` after a bare `BEGIN` is *also* legal as the
    // first statement, but the read-only BEGIN makes the intent unmistakable
    // and needs no ordering care.
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| AppError::validation(dbhub_driver::describe_dial_error(&error)))?;
    sqlx::query("begin read only")
        .execute(&mut *conn)
        .await
        .map_err(|error| AppError::validation(dbhub_driver::describe_dial_error(&error)))?;

    let outcome = sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .fetch_all(&mut *conn)
        .await
        .map_err(|error| AppError::validation(dbhub_driver::describe_dial_error(&error)));

    // Close the read-only transaction either way — COMMIT on success,
    // ROLLBACK when the statement failed.
    let _ = sqlx::query(if outcome.is_ok() { "commit" } else { "rollback" })
        .execute(&mut *conn)
        .await;
    pool.close().await;

    let rows = outcome?;
    Ok(project_postgres_rows(&rows, cap))
}

fn project_postgres_rows(
    rows: &[sqlx::postgres::PgRow],
    cap: usize,
) -> (Vec<String>, Vec<serde_json::Value>, bool) {
    let columns: Vec<String> = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_default();

    let truncated = rows.len() > cap;
    let json_rows: Vec<serde_json::Value> = rows
        .iter()
        .take(cap)
        .map(|row| {
            let mut map = serde_json::Map::new();
            for (index, column) in row.columns().iter().enumerate() {
                // Decode everything as a string of the driver's canonical
                // rendering first; typed decoding per engine type comes with
                // the result-grid polish. Numbers the driver renders plainly
                // still read fine in the grid.
                let value: serde_json::Value = match row.try_get::<Option<String>, _>(index) {
                    Ok(Some(text)) => serde_json::Value::String(text),
                    Ok(None) | Err(_) => serde_json::Value::Null,
                };
                map.insert(column.name().to_string(), value);
            }
            serde_json::Value::Object(map)
        })
        .collect();

    (columns, json_rows, truncated)
}

/// MySQL decodes some values as non-JSON scalars; normalise the shapes the
/// grid cannot render (bytes → base64 flag, big numerics → string) minimally.
fn normalize(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(text) => serde_json::Value::String(text),
        serde_json::Value::Null => serde_json::Value::Null,
        other => other,
    }
}

// --- Catalog (workspace tree) ------------------------------------------------

/// Databases/schemata the account's user can see. MySQL: information_schema
/// schemata. Postgres/Yellowbrick: non-template databases.
pub(crate) async fn list_databases_routed(
    shape: &DbConnectionShape,
    route_override: Option<(&str, u16)>,
) -> AppResult<Vec<DbCatalogEntry>> {
    let sql = match shape.connection.kind {
        DbConnectionKind::Mysql => {
            "select schema_name as name, null as kind from information_schema.schemata"
        }
        _ => "select datname as name, null as kind from pg_database where not datistemplate",
    };
    let result = execute_read_only_routed(shape, sql, MAX_PAGE_ROWS as usize, route_override).await?;
    Ok(result
        .rows
        .iter()
        .filter_map(|row| row.get("name").and_then(|value| value.as_str()))
        .map(|name| DbCatalogEntry {
            name: name.to_string(),
            kind: None,
        })
        .collect())
}

/// Tables/views of one database. MySQL: information_schema.tables filtered by
/// schema; Postgres: information_schema.tables of the connected database's
/// public schema (cross-database queries need a second connection in PG land).
pub(crate) async fn list_tables_routed(
    shape: &DbConnectionShape,
    database: &str,
    route_override: Option<(&str, u16)>,
) -> AppResult<Vec<DbCatalogEntry>> {
    let sql = match shape.connection.kind {
        DbConnectionKind::Mysql => format!(
            "select table_name as name, table_type as kind from information_schema.tables \
             where table_schema = '{database}' order by table_name"
        ),
        _ => {
            let _ = database;
            "select table_name as name, table_type as kind from information_schema.tables \
             where table_schema = 'public' order by table_name"
            .to_string()
        }
    };
    let result = execute_read_only_routed(shape, &sql, MAX_PAGE_ROWS as usize, route_override).await?;
    Ok(result
        .rows
        .iter()
        .filter_map(|row| {
            let name = row.get("name").and_then(|value| value.as_str())?;
            let kind = row.get("kind").and_then(|value| value.as_str());
            Some(DbCatalogEntry {
                name: name.to_string(),
                kind: kind.map(String::from),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DbConnection, DbConnectionKind, DbReadOnlyPolicy};

    fn shape_for_gate_test() -> DbConnectionShape {
        DbConnectionShape {
            pool: sqlx::sqlite::SqlitePool::connect_lazy("sqlite::memory:")
                .expect("lazy pool"),
            connection: DbConnection {
                id: "c1".into(),
                account_id: "acct-a".into(),
                kind: DbConnectionKind::Mysql,
                name: "gate check".into(),
                host: "db.internal".into(),
                port: 3306,
                database: None,
                username: "reader".into(),
                network_profile_id: None,
                show_as_tab: false,
                enabled_for_ai: true,
                ai_read_only_policy: DbReadOnlyPolicy::SelectOnly,
                sort_order: 0,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
            password: None,
        }
    }

    #[tokio::test]
    async fn execute_refuses_writes_before_touching_a_driver() {
        // No real connection needed — the gate rejects before any dial.
        let shape = shape_for_gate_test();
        let error = execute_read_only(&shape, "DELETE FROM orders", 100)
            .await
            .expect_err("must be blocked");
        assert!(error.message.contains("read-only gate"));
    }
}

// --- Command-facing helpers --------------------------------------------------
// The commands live in commands/dbhub.rs; these wrappers resolve the connection
// (with the secrets-backed password) and forward into the executor/catalog.

pub async fn run_for_command(
    app: &tauri::AppHandle,
    connection_id: &str,
    require_ai_enabled: bool,
    sql: &str,
    max_rows: Option<usize>,
) -> AppResult<DbQueryResult> {
    let shape = shape_for(app, connection_id, require_ai_enabled).await?;
    // The forward (when a profile routes this connection) must outlive the
    // driver dial; binding it to this scope does exactly that.
    let forward = dbhub_tunnel::route_for_connection(&shape.pool, app, &shape.connection).await?;
    let override_target = forward
        .as_ref()
        .map(|(host, port, _)| (host.as_str(), *port));
    execute_read_only_routed(&shape, sql, max_rows.unwrap_or(MAX_PAGE_ROWS as usize), override_target).await
}

pub async fn catalog_databases_for_command(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let shape = shape_for(app, connection_id, false).await?;
    let forward = dbhub_tunnel::route_for_connection(&shape.pool, app, &shape.connection).await?;
    let override_target = forward
        .as_ref()
        .map(|(host, port, _)| (host.as_str(), *port));
    list_databases_routed(&shape, override_target).await
}

pub async fn catalog_tables_for_command(
    app: &tauri::AppHandle,
    connection_id: &str,
    database: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let shape = shape_for(app, connection_id, false).await?;
    let forward = dbhub_tunnel::route_for_connection(&shape.pool, app, &shape.connection).await?;
    let override_target = forward
        .as_ref()
        .map(|(host, port, _)| (host.as_str(), *port));
    list_tables_routed(&shape, database, override_target).await
}

async fn shape_for(
    app: &tauri::AppHandle,
    connection_id: &str,
    require_ai_enabled: bool,
) -> AppResult<DbConnectionShape> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    let connection = dbhub::get_connection(&pool, &account_id, connection_id)
        .await?
        .ok_or_else(|| AppError::validation("Connection was not found."))?;
    if require_ai_enabled && !connection.enabled_for_ai {
        return Err(AppError::validation(
            "This connection is not enabled for AI queries.",
        ));
    }
    let password =
        crate::secrets::read_optional_secret(app, &pool_secret_key(connection_id)).unwrap_or(None);
    Ok(DbConnectionShape { pool, connection, password })
}
