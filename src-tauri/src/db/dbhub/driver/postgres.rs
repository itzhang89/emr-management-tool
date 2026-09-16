//! PostgreSQL, over sqlx.
//!
//! Postgres has an explicit read-only transaction, so unlike MySQL the promise
//! is made by the transaction that wraps the statement: `BEGIN READ ONLY` is
//! legal to open with, needs no ordering care, and the transaction is closed
//! either way — `COMMIT` on success, `ROLLBACK` when the statement failed.
//!
//! The catalog reads and the connection core here are shared with
//! [`super::yellowbrick`], which speaks this wire protocol.

use async_trait::async_trait;
use sqlx::{PgPool, Row};

use crate::error::{AppError, AppResult};
use crate::models::DbConnectionKind;

use super::super::session::{self, QueryCancellation, CONNECT_TIMEOUT};
use super::{
    catalog_entries, DbCatalogEntry, DbDial, DbDriver, QueryPage, ServerInfo, MAX_PAGE_ROWS,
};

/// The engine behind a Postgres connection.
pub struct PostgresDriver;

/// Databases this user can see. `datistemplate` filters out the two template
/// databases, which are not queryable targets.
pub(crate) const DATABASES_SQL: &str =
    "select datname as name, null as kind from pg_database where not datistemplate";

/// The schemas the connected user can see.
///
/// `information_schema.schemata` is privilege-aware — it holds the schemas the
/// user owns or has some right on — so the tree does not offer a schema that
/// would fail the moment it was opened. `pg_%` covers `pg_catalog`,
/// `pg_toast` and the per-session `pg_temp_N`; `information_schema` itself is
/// the only system schema not caught by that pattern. Both are noise in a
/// query tool's tree.
pub(crate) const SCHEMAS_SQL: &str = "select schema_name as name, null as kind \
     from information_schema.schemata \
     where schema_name not like 'pg\\_%' and schema_name <> 'information_schema' \
     order by schema_name";

/// Tables and views of one schema.
pub(crate) fn tables_sql(schema: &str) -> String {
    format!(
        "select table_name as name, table_type as kind from information_schema.tables \
         where table_schema = {} order by table_name",
        session::quote_literal(schema)
    )
}

#[async_trait]
impl DbDriver for PostgresDriver {
    fn kind(&self) -> DbConnectionKind {
        DbConnectionKind::Postgres
    }

    async fn initialize(&self, dial: &DbDial<'_>) -> AppResult<ServerInfo> {
        initialize(dial).await
    }

    async fn list_databases(&self, dial: &DbDial<'_>) -> AppResult<Vec<DbCatalogEntry>> {
        let page = read_page(
            dial,
            DATABASES_SQL,
            MAX_PAGE_ROWS,
            &QueryCancellation::never(),
        )
        .await?;
        Ok(catalog_entries(&page))
    }

    async fn list_schemas(&self, dial: &DbDial<'_>) -> AppResult<Vec<DbCatalogEntry>> {
        let page = read_page(
            dial,
            SCHEMAS_SQL,
            MAX_PAGE_ROWS,
            &QueryCancellation::never(),
        )
        .await?;
        Ok(catalog_entries(&page))
    }

    async fn list_tables(&self, dial: &DbDial<'_>, schema: &str) -> AppResult<Vec<DbCatalogEntry>> {
        let page = read_page(
            dial,
            &tables_sql(schema),
            MAX_PAGE_ROWS,
            &QueryCancellation::never(),
        )
        .await?;
        Ok(catalog_entries(&page))
    }

    async fn query(
        &self,
        dial: &DbDial<'_>,
        sql: &str,
        cap: usize,
        cancel: &QueryCancellation<'_>,
    ) -> AppResult<QueryPage> {
        read_page(dial, sql, cap, cancel).await
    }
}

/// Build a Postgres connection URL for this dial. A connection that names no
/// database lands on `postgres`, the maintenance database every server has.
pub(crate) fn postgres_url(dial: &DbDial<'_>) -> String {
    session::scheme_url(
        "postgresql",
        dial,
        Some(dial.database().unwrap_or("postgres")),
    )
}

/// Open a one-connection pool, run `SELECT version()`, close.
pub(crate) async fn initialize(dial: &DbDial<'_>) -> AppResult<ServerInfo> {
    let pool = connect(dial).await?;
    let version = sqlx::query_scalar::<_, String>("select version()")
        .fetch_one(&pool)
        .await
        .map_err(|error| AppError::validation(session::describe_error(&error)));
    pool.close().await;
    Ok(ServerInfo { version: version? })
}

pub(crate) async fn connect(dial: &DbDial<'_>) -> AppResult<PgPool> {
    sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(CONNECT_TIMEOUT)
        .max_connections(1)
        .connect(&postgres_url(dial))
        .await
        .map_err(|error| session::dial_error(dial, &error))
}

/// One statement inside a read-only transaction, at most `cap` rows.
pub(crate) async fn read_page(
    dial: &DbDial<'_>,
    sql: &str,
    cap: usize,
    cancel: &QueryCancellation<'_>,
) -> AppResult<QueryPage> {
    let pool = connect(dial).await?;
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| AppError::validation(session::describe_error(&error)))?;

    sqlx::query(if dial.writable {
        "begin"
    } else {
        "begin read only"
    })
    .execute(&mut *conn)
    .await
    .map_err(|error| AppError::validation(session::describe_error(&error)))?;

    let rows = session::fetch_capped(
        sqlx::query(sqlx::AssertSqlSafe(sql.to_string())),
        &mut *conn,
        cap,
        cancel,
    )
    .await;

    // Close the transaction either way — a failed statement must not leave the
    // session holding one open until the connection is dropped.
    let _ = sqlx::query(if rows.is_ok() { "commit" } else { "rollback" })
        .execute(&mut *conn)
        .await;

    // The connection must be back in the pool before it can be closed — a
    // checked-out connection is a permit `close()` waits on.
    drop(conn);
    pool.close().await;

    Ok(session::project(&rows?, cap, cell_to_json))
}

/// Decode one Postgres cell into a JSON value.
///
/// Everything goes through the driver's canonical string rendering: numbers
/// the driver renders plainly still read fine in the grid, and a type this
/// does not know stays visible as text instead of vanishing. Typed decoding
/// per engine type is a grid-polish follow-up.
fn cell_to_json(row: &sqlx::postgres::PgRow, index: usize) -> serde_json::Value {
    match row.try_get::<Option<String>, _>(index) {
        Ok(Some(text)) => serde_json::Value::String(text),
        Ok(None) | Err(_) => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dbhub::driver::DialTarget;
    use crate::models::{DbConnection, DbReadOnlyPolicy};

    fn connection() -> DbConnection {
        DbConnection {
            id: "c1".into(),
            account_id: "acct-a".into(),
            kind: DbConnectionKind::Postgres,
            name: "Test".into(),
            host: "db.internal".into(),
            port: 5432,
            database: None,
            username: "bi reader".into(),
            network_profile_id: None,
            show_as_tab: false,
            enabled_for_ai: true,
            ai_read_only_policy: DbReadOnlyPolicy::SelectOnly,
            allow_writes: false,
            sort_order: 0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn tables_sql_filters_on_the_given_schema() {
        let sql = tables_sql("public");
        assert!(sql.contains("where table_schema = 'public'"), "{sql}");

        // The schema name is a value, not a fragment: a quote in it must not
        // be able to end the literal.
        assert!(tables_sql("o'brien").contains("'o''brien'"));
    }

    #[test]
    fn url_defaults_database_when_none_is_named() {
        let connection = connection();
        let target = DialTarget::direct(&connection);
        let dial = DbDial::new(&connection, &target, None);
        assert!(
            postgres_url(&dial).starts_with("postgresql://bi%20reader:@db.internal:5432/postgres")
        );
    }

    #[test]
    fn url_uses_the_named_database_when_there_is_one() {
        let mut connection = connection();
        connection.database = Some("warehouse".into());
        let target = DialTarget::direct(&connection);
        let dial = DbDial::new(&connection, &target, Some("pw"));
        assert_eq!(
            postgres_url(&dial),
            "postgresql://bi%20reader:pw@db.internal:5432/warehouse"
        );
    }

    #[tokio::test]
    async fn initialize_reports_a_readable_error_for_an_unreachable_host() {
        let mut connection = connection();
        connection.host = "127.0.0.1".into();
        connection.port = 1;
        let target = DialTarget::direct(&connection);
        let dial = DbDial::new(&connection, &target, Some("wrong"));
        let error = PostgresDriver
            .initialize(&dial)
            .await
            .expect_err("the dial must fail");
        assert!(
            error
                .message
                .starts_with("Could not reach 127.0.0.1:1 (direct):"),
            "{error:?}"
        );
        assert!(error.message.len() <= 300);
    }
}
