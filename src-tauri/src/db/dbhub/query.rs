//! Read-only SQL execution for DBHub connections (design section 8): the
//! command layer that wraps the read-only gate and hands the statement to
//! whichever driver the connection's kind resolves to.
//!
//! Nothing in this module knows an engine. The gate classifies the statement,
//! the registry picks a driver, the driver runs it inside a read-only session,
//! and the page comes back as JSON. Adding MSSQL or Oracle changes none of it.

use serde::Serialize;

use crate::db::dbhub::{driver, gate, tunnel};
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::DbConnection;

use super::session::complete_operation;
use driver::{DbDial, DialTarget, MAX_PAGE_ROWS};

pub use driver::DbCatalogEntry;

/// One page of query results, as the workspace and the AI tools consume it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    pub row_count: usize,
    pub truncated: bool,
    pub duration_ms: u64,
}

fn pool_secret_key(id: &str) -> String {
    format!("db/{id}/password")
}

/// The fields the executor needs, split out so tests and the MCP tools can
/// build one without a Tauri handle. `pool` is the app's SQLite pool (used to
/// resolve the network profile when routing).
pub struct DbConnectionShape {
    pub pool: sqlx::SqlitePool,
    pub connection: DbConnection,
    pub password: Option<String>,
}

impl DbConnectionShape {
    /// Bind this connection and its secret to one dial target.
    pub fn dial<'a>(&'a self, target: &'a DialTarget) -> DbDial<'a> {
        DbDial::new(&self.connection, target, self.password.as_deref())
    }
}

/// Resolve the connection a command named, scoped to the active account.
pub(crate) async fn shape_for(
    app: &tauri::AppHandle,
    connection_id: &str,
    require_ai_enabled: bool,
) -> AppResult<DbConnectionShape> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    let connection = crate::db::dbhub::get_connection(&pool, &account_id, connection_id)
        .await?
        .ok_or_else(|| AppError::validation("Connection was not found."))?;
    if require_ai_enabled && !connection.enabled_for_ai {
        return Err(AppError::validation(
            "This connection is not enabled for AI queries.",
        ));
    }
    let password =
        crate::secrets::read_optional_secret(app, &pool_secret_key(connection_id)).unwrap_or(None);
    Ok(DbConnectionShape {
        pool,
        connection,
        password,
    })
}

async fn active_account_id(pool: &sqlx::SqlitePool) -> AppResult<String> {
    repository::active_aws_account(pool)
        .await?
        .map(|account| account.id)
        .ok_or_else(|| {
            AppError::validation("No active AWS account. Configure one in Settings first.")
        })
}

/// The single execution path for read-only SQL.
///
/// The gate runs first and refuses anything it cannot prove is a read; the
/// driver then opens its own short-lived read-only session (a query tab fires
/// at human cadence — pooling across calls is a later optimisation), runs the
/// statement and caps the page. `target` is where the driver dials: the
/// connection's own address, or a network profile's local forward.
pub(crate) async fn execute_read_only(
    shape: &DbConnectionShape,
    target: &DialTarget,
    sql: &str,
    max_rows: usize,
) -> AppResult<DbQueryResult> {
    if let gate::StatementClass::Blocked { reason } = gate::classify(sql) {
        return Err(AppError::validation(format!(
            "Blocked by the read-only gate: {reason}"
        )));
    }

    let cap = max_rows.clamp(1, MAX_PAGE_ROWS);
    let started = std::time::Instant::now();
    let page = driver::driver_for(shape.connection.kind)
        .query(&shape.dial(target), sql, cap)
        .await?;

    Ok(DbQueryResult {
        columns: page.columns,
        row_count: page.rows.len(),
        rows: page.rows,
        truncated: page.truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// The human query tab's entry point: resolve the connection, open its route,
/// run the statement.
pub async fn run_for_command(
    app: &tauri::AppHandle,
    connection_id: &str,
    require_ai_enabled: bool,
    sql: &str,
    max_rows: Option<usize>,
) -> AppResult<DbQueryResult> {
    let shape = shape_for(app, connection_id, require_ai_enabled).await?;
    complete_operation("query", async {
        // The forward (when a profile routes this connection) must outlive the
        // driver dial; binding it to this scope does exactly that.
        let (target, _forward) =
            tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
        execute_read_only(&shape, &target, sql, max_rows.unwrap_or(MAX_PAGE_ROWS)).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DbConnectionKind, DbReadOnlyPolicy};

    fn shape_for_gate_test() -> DbConnectionShape {
        DbConnectionShape {
            pool: sqlx::sqlite::SqlitePool::connect_lazy("sqlite::memory:").expect("lazy pool"),
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
        let target = DialTarget::direct(&shape.connection);
        let error = execute_read_only(&shape, &target, "DELETE FROM orders", 100)
            .await
            .expect_err("must be blocked");
        assert!(error.message.contains("read-only gate"));
    }

    #[tokio::test]
    async fn a_blocked_statement_never_reaches_the_network() {
        // The target points at a closed port: if the gate let the statement
        // through, this would fail with a dial error instead of a gate error.
        let mut shape = shape_for_gate_test();
        shape.connection.host = "127.0.0.1".into();
        shape.connection.port = 1;
        let target = DialTarget::direct(&shape.connection);
        let error = execute_read_only(&shape, &target, "SELECT 1", 100)
            .await
            .expect_err("the dial must fail, not the gate");
        assert!(!error.message.contains("read-only gate"));
    }
}
