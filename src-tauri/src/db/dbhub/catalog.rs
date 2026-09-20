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

use crate::db::dbhub::{driver, query, store, tunnel};
use crate::error::AppResult;
use tauri::AppHandle;

use super::session::complete_operation;
use driver::{DbCatalogEntry, DialTarget, SchemaObject};
use query::{shape_for, DbConnectionShape};

/// Whether a cached level may still be served.
///
/// Refreshed on the first read of each day: a day-old tree is worth re-asking
/// about, and once a day keeps the asking rare without leaving the user
/// looking at last week's tables. Everything else is the refresh button's job.
fn cache_is_fresh(refreshed_at: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(refreshed_at)
        .map(|at| {
            at.with_timezone(&chrono::Local).date_naive() == chrono::Local::now().date_naive()
        })
        .unwrap_or(false)
}

/// Read one level through the cache.
///
/// `fetch` runs only when there is nothing usable to serve — the whole point
/// of the cache being that opening the tree, switching tabs and coming back
/// are all SQLite reads rather than round trips to the database.
async fn cached<F, Fut>(
    pool: &sqlx::SqlitePool,
    connection_id: &str,
    level: &str,
    database: &str,
    schema: &str,
    kinds: &str,
    fetch: F,
) -> AppResult<Vec<DbCatalogEntry>>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = AppResult<Vec<DbCatalogEntry>>>,
{
    if let Some((payload, refreshed_at)) =
        store::read_catalog_cache(pool, connection_id, level, database, schema, kinds).await?
    {
        if cache_is_fresh(&refreshed_at) {
            if let Ok(entries) = serde_json::from_str::<Vec<DbCatalogEntry>>(&payload) {
                return Ok(entries);
            }
            // A payload we cannot read is treated as no cache at all: the
            // database is the source of truth, and a parse failure is one more
            // reason to go and ask it rather than to fail.
        }
    }

    let entries = fetch().await?;
    if let Ok(payload) = serde_json::to_string(&entries) {
        // Failing to cache is not failing to answer.
        let _ = store::write_catalog_cache(
            pool,
            connection_id,
            level,
            database,
            schema,
            kinds,
            &payload,
        )
        .await;
    }
    Ok(entries)
}

/// Drop this connection's cached tree, so the next read goes and asks.
pub async fn refresh_catalog_for_command(app: &AppHandle, connection_id: &str) -> AppResult<()> {
    let shape = shape_for(app, connection_id, false).await?;
    store::clear_catalog_cache(&shape.pool, connection_id).await
}

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

/// The objects of one schema, of the kinds the tree asked for.
pub(crate) async fn list_objects(
    shape: &DbConnectionShape,
    target: &DialTarget,
    database: &str,
    schema: &str,
    kinds: &[SchemaObject],
) -> AppResult<Vec<DbCatalogEntry>> {
    let dial = shape.dial(target);
    driver::driver_for(shape.connection.kind)
        .list_objects(&dial.reading(database), schema, kinds)
        .await
}

pub async fn catalog_databases_for_command(
    app: &AppHandle,
    connection_id: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let shape = shape_for(app, connection_id, false).await?;
    cached(
        &shape.pool,
        connection_id,
        "databases",
        "",
        "",
        "",
        || async {
            complete_operation("database catalog request", async {
                let (target, _forward) =
                    tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
                list_databases(&shape, &target).await
            })
            .await
        },
    )
    .await
}

pub async fn catalog_schemas_for_command(
    app: &AppHandle,
    connection_id: &str,
    database: &str,
) -> AppResult<Vec<DbCatalogEntry>> {
    let shape = shape_for(app, connection_id, false).await?;
    cached(
        &shape.pool,
        connection_id,
        "schemas",
        database,
        "",
        "",
        || async {
            complete_operation("schema catalog request", async {
                let (target, _forward) =
                    tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
                list_schemas(&shape, &target, database).await
            })
            .await
        },
    )
    .await
}

pub async fn catalog_objects_for_command(
    app: &AppHandle,
    connection_id: &str,
    database: &str,
    schema: &str,
    kinds: &[SchemaObject],
) -> AppResult<Vec<DbCatalogEntry>> {
    let shape = shape_for(app, connection_id, false).await?;
    // The kinds are part of the key: looking at views is a different question
    // from looking at tables, and one answer must not stand in for the other.
    let mut names: Vec<&str> = kinds.iter().map(|kind| kind.as_str()).collect();
    names.sort_unstable();
    let kinds_key = names.join(",");
    cached(
        &shape.pool,
        connection_id,
        "objects",
        database,
        schema,
        &kinds_key,
        || async {
            complete_operation("object catalog request", async {
                let (target, _forward) =
                    tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
                list_objects(&shape, &target, database, schema, kinds).await
            })
            .await
        },
    )
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
            auth_mode: crate::models::DbAuthMode::Manual,
            secret_arn: None,
            secret_name: None,
                sort_order: 0,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
            password: None,
        }
    }

    #[test]
    fn a_cache_entry_is_good_for_the_day_it_was_read() {
        let now = chrono::Local::now();
        assert!(cache_is_fresh(&now.to_rfc3339()));
        // Yesterday's tree is worth re-asking about — the daily refresh,
        // expressed as a property of the entry rather than as a separate
        // schedule to keep in step with it.
        assert!(!cache_is_fresh(&(now - chrono::Duration::days(1)).to_rfc3339()));
        // A payload that cannot say when it was read is not one to trust.
        assert!(!cache_is_fresh("not a timestamp"));
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
    async fn object_listing_asks_the_driver_for_the_named_schema() {
        let shape = shape_for_gate_test();
        let target = DialTarget::direct(&shape.connection);
        let error = list_objects(&shape, &target, "sales", "public", &[SchemaObject::Table])
            .await
            .expect_err("the dial must fail");
        assert!(!error.message.contains("read-only gate"));
    }

    #[tokio::test]
    async fn asking_for_no_kinds_costs_no_dial() {
        // Nothing requested is nothing to ask the database for — the tree
        // reaching a state where every kind is unchecked must not become a
        // query that fails.
        let shape = shape_for_gate_test();
        let target = DialTarget::direct(&shape.connection);
        assert!(list_objects(&shape, &target, "sales", "public", &[])
            .await
            .expect("nothing to ask for")
            .is_empty());
    }
}
