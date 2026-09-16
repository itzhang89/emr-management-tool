//! The query workspace's catalog tree: which databases a connection can see,
//! which schemas live in one, and which tables live in one of those.
//!
//! All three questions are engine questions — MySQL reads
//! `information_schema`, Postgres reads `pg_database` and then
//! `information_schema`, and whatever MSSQL and Oracle read is theirs to
//! know. So all this module does is resolve the connection, open its route,
//! and ask the driver.
//!
//! Every level below the first is read *from the database it names* (see
//! [`DialTarget`]'s companion, `DbDial::reading`): a server that separates
//! database from schema has no cross-database query, so reading another
//! database's schemas means connecting to it. An engine with no schema level
//! answers `list_schemas` with nothing, and the tree goes straight to tables.
//!
//! The SQL those calls run is authored here in the crate, not typed by a user,
//! which is why it does not pass through the read-only gate: the gate is for
//! statements that arrived from outside. The driver still runs them inside its
//! read-only session like everything else.

use crate::db::dbhub::{driver, query, tunnel};
use crate::error::AppResult;
use tauri::AppHandle;

use super::session::complete_operation;
use driver::{DbCatalogEntry, DialTarget};
use query::{shape_for, DbConnectionShape};

/// The databases (MySQL schemata, Postgres databases) a connection can see.
pub(crate) async fn list_databases(
    shape: &DbConnectionShape,
    target: &DialTarget,
) -> AppResult<Vec<DbCatalogEntry>> {
    driver::driver_for(shape.connection.kind)
        .list_databases(&shape.dial(target))
        .await
}

/// The schemas of one database.
pub(crate) async fn list_schemas(
    shape: &DbConnectionShape,
    target: &DialTarget,
    database: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let dial = shape.dial(target);
    driver::driver_for(shape.connection.kind)
        .list_schemas(&dial.reading(database))
        .await
}

/// The tables and views of one schema, in one database.
pub(crate) async fn list_tables(
    shape: &DbConnectionShape,
    target: &DialTarget,
    database: &str,
    schema: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let dial = shape.dial(target);
    driver::driver_for(shape.connection.kind)
        .list_tables(&dial.reading(database), schema)
        .await
}

pub async fn catalog_databases_for_command(
    app: &AppHandle,
    connection_id: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let shape = shape_for(app, connection_id, false).await?;
    complete_operation("database catalog request", async {
        let (target, _forward) =
            tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
        list_databases(&shape, &target).await
    })
    .await
}

pub async fn catalog_schemas_for_command(
    app: &AppHandle,
    connection_id: &str,
    database: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let shape = shape_for(app, connection_id, false).await?;
    complete_operation("schema catalog request", async {
        let (target, _forward) =
            tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
        list_schemas(&shape, &target, database).await
    })
    .await
}

pub async fn catalog_tables_for_command(
    app: &AppHandle,
    connection_id: &str,
    database: &str,
    schema: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let shape = shape_for(app, connection_id, false).await?;
    complete_operation("table catalog request", async {
        let (target, _forward) =
            tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
        list_tables(&shape, &target, database, schema).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DbConnection, DbConnectionKind, DbReadOnlyPolicy};

    fn shape_for_gate_test() -> DbConnectionShape {
        DbConnectionShape {
            pool: sqlx::sqlite::SqlitePool::connect_lazy("sqlite::memory:").expect("lazy pool"),
            connection: DbConnection {
                id: "c1".into(),
                account_id: "acct-a".into(),
                kind: DbConnectionKind::Mysql,
                name: "catalog check".into(),
                host: "127.0.0.1".into(),
                port: 1, // closed: the dial fails, which is the point
                database: None,
                username: "reader".into(),
                network_profile_id: None,
                show_as_tab: false,
                enabled_for_ai: true,
                ai_read_only_policy: DbReadOnlyPolicy::SelectOnly,
                allow_writes: false,
                sort_order: 0,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
            password: None,
        }
    }

    #[tokio::test]
    async fn catalog_reads_go_through_the_driver_not_the_gate() {
        // A catalog read is app-authored SQL, so the read-only gate (which
        // would answer "no SQL statement to run") must let it past — the
        // failure here has to be the dial, proving it reached the driver.
        let shape = shape_for_gate_test();
        let target = DialTarget::direct(&shape.connection);
        let error = list_databases(&shape, &target)
            .await
            .expect_err("the dial must fail");
        assert!(!error.message.contains("read-only gate"));
        assert!(!error.message.contains("No SQL statement"));
    }

    #[tokio::test]
    async fn mysql_schema_listing_is_empty_and_never_dials() {
        // MySQL's schema *is* its database, so there is no third level to
        // show. Answering empty is how the driver says so — and it says it
        // without touching the network, which this unreachable host proves.
        let shape = shape_for_gate_test();
        let target = DialTarget::direct(&shape.connection);
        let schemas = list_schemas(&shape, &target, "sales")
            .await
            .expect("no dial is needed to answer this");
        assert!(schemas.is_empty());
    }

    #[tokio::test]
    async fn table_listing_asks_the_driver_for_the_named_schema() {
        let shape = shape_for_gate_test();
        let target = DialTarget::direct(&shape.connection);
        let error = list_tables(&shape, &target, "sales", "public")
            .await
            .expect_err("the dial must fail");
        assert!(!error.message.contains("read-only gate"));
    }
}
