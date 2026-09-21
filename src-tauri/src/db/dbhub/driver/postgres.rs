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
use bigdecimal::BigDecimal;
use sqlx::{PgPool, Row};

use crate::error::{AppError, AppResult};
use crate::models::DbConnectionKind;

use super::super::session::{self, QueryCancellation, CONNECT_TIMEOUT};
use super::{
    catalog_entries, hex_encode, DbCatalogEntry, DbDial, DbDriver, QueryPage, SchemaObject,
    ServerInfo, MAX_PAGE_ROWS,
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

/// Relations of one schema, for whichever of them were asked for.
///
/// One catalogue read covers tables, views and foreign tables — Postgres
/// already says which is which in `table_type`, so a tree showing only tables
/// is filtering here rather than fetching the rest and dropping them.
fn relations_sql(schema: &str, kinds: &[SchemaObject]) -> Option<String> {
    let types: Vec<&str> = kinds
        .iter()
        .filter_map(|kind| match kind {
            SchemaObject::Table => Some("'BASE TABLE'"),
            SchemaObject::View => Some("'VIEW'"),
            SchemaObject::ForeignTable => Some("'FOREIGN'"),
            _ => None,
        })
        .collect();
    (!types.is_empty()).then(|| {
        format!(
            "select table_name as name,              case table_type when 'VIEW' then 'view' when 'FOREIGN' then 'foreign-table'              else 'table' end as kind              from information_schema.tables where table_schema = {} and table_type in ({})              order by table_name",
            session::quote_literal(schema),
            types.join(", ")
        )
    })
}

/// Materialized views of one schema.
///
/// They are **not** in `information_schema.tables` — Postgres keeps them only
/// in the catalogue view `pg_matviews`, which is why they need a read of their
/// own rather than another `table_type`.
fn matviews_sql(schema: &str) -> String {
    format!(
        "select matviewname as name, 'materialized-view' as kind from pg_matviews \
         where schemaname = {} order by matviewname",
        session::quote_literal(schema)
    )
}

/// Functions of one schema. `information_schema.routines` holds procedures
/// too; Postgres has none through this path in practice, but the filter is
/// what states the intent.
fn functions_sql(schema: &str) -> String {
    format!(
        "select routine_name as name, 'function' as kind from information_schema.routines \
         where routine_schema = {} and routine_type = 'FUNCTION' order by routine_name",
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

    async fn list_objects(
        &self,
        dial: &DbDial<'_>,
        schema: &str,
        kinds: &[SchemaObject],
    ) -> AppResult<Vec<DbCatalogEntry>> {
        list_objects(dial, schema, kinds).await
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

/// The objects of one schema, of the kinds asked for.
///
/// Shared with [`super::yellowbrick`], which is also why the tolerance for an
/// absent `pg_matviews` lives here.
pub(crate) async fn list_objects(
    dial: &DbDial<'_>,
    schema: &str,
    kinds: &[SchemaObject],
) -> AppResult<Vec<DbCatalogEntry>> {
    let mut entries = Vec::new();
    // One round trip per catalogue read, and only for the kinds asked for.
    if let Some(sql) = relations_sql(schema, kinds) {
        let page = read_page(dial, &sql, MAX_PAGE_ROWS, &QueryCancellation::never()).await?;
        entries.extend(catalog_entries(&page));
    }
    if kinds.contains(&SchemaObject::MaterializedView) {
        // Tolerated for Yellowbrick alone: it speaks this wire without
        // promising Postgres's catalogue views, so an absent `pg_matviews`
        // there is expected. Postgres itself always has it, and a failure
        // there is a real one the user should hear about.
        let outcome = read_page(
            dial,
            &matviews_sql(schema),
            MAX_PAGE_ROWS,
            &QueryCancellation::never(),
        )
        .await;
        match outcome {
            Ok(page) => entries.extend(catalog_entries(&page)),
            Err(_) if dial.connection.kind == DbConnectionKind::Yellowbrick => {}
            Err(error) => return Err(error),
        }
    }
    if kinds.contains(&SchemaObject::Function) {
        let page = read_page(
            dial,
            &functions_sql(schema),
            MAX_PAGE_ROWS,
            &QueryCancellation::never(),
        )
        .await?;
        entries.extend(catalog_entries(&page));
    }
    Ok(entries)
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
/// By column type, because Postgres will not render a date or a number as text:
/// asking for a `TIMESTAMP` or an `int4` as a `String` is not a decode that
/// happens to be lossy, it is a decode that fails — and swallowing that failure
/// is how every date, timestamp and integer in a result used to arrive in the
/// grid as `NULL`, with nothing anywhere to say so.
///
/// The chain is a search for the one type that fits. `try_get` refuses a column
/// whose SQL type does not match the Rust type being asked for — see
/// `Row::try_get`, which checks `T::compatible` before it decodes — so a
/// `text` column cannot be read as a number by accident, it fails to be read as
/// one. That check is exact for the numeric types, which is why there is an arm
/// per width: `i64` takes an `int8` and turns an `int4` down.
///
/// Temporal values become strings rather than numbers. A timestamp is a point
/// in time, not a quantity, and the grid already sorts an ISO rendering
/// correctly as text. `timestamptz` keeps its offset in that rendering, because
/// one without it names a different instant to every reader in a different
/// place. `numeric` keeps its digits, because that is the only thing that makes
/// it `numeric` rather than `float8`.
fn cell_to_json(row: &sqlx::postgres::PgRow, index: usize) -> serde_json::Value {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};

    if let Ok(Some(text)) = row.try_get::<Option<String>, _>(index) {
        return serde_json::Value::String(text);
    }
    // timestamp
    if let Ok(Some(at)) = row.try_get::<Option<NaiveDateTime>, _>(index) {
        return serde_json::Value::String(at.to_string());
    }
    // timestamptz
    if let Ok(Some(at)) = row.try_get::<Option<DateTime<Utc>>, _>(index) {
        return serde_json::Value::String(at.to_rfc3339());
    }
    // date
    if let Ok(Some(day)) = row.try_get::<Option<NaiveDate>, _>(index) {
        return serde_json::Value::String(day.to_string());
    }
    // time
    if let Ok(Some(at)) = row.try_get::<Option<NaiveTime>, _>(index) {
        return serde_json::Value::String(at.to_string());
    }
    // json / jsonb — handed over as JSON rather than as its text, so the grid
    // can colour it as a structure instead of quoting it as one long string
    if let Ok(Some(document)) = row.try_get::<Option<serde_json::Value>, _>(index) {
        return document;
    }
    // uuid, spelled the way it is written everywhere else
    if let Ok(Some(id)) = row.try_get::<Option<uuid::Uuid>, _>(index) {
        return serde_json::Value::String(id.to_string());
    }
    // numeric
    if let Ok(Some(number)) = row.try_get::<Option<BigDecimal>, _>(index) {
        return serde_json::Value::String(number.to_string());
    }
    // int2 / int4 / int8
    if let Ok(Some(number)) = row.try_get::<Option<i16>, _>(index) {
        return serde_json::Value::Number(number.into());
    }
    if let Ok(Some(number)) = row.try_get::<Option<i32>, _>(index) {
        return serde_json::Value::Number(number.into());
    }
    if let Ok(Some(number)) = row.try_get::<Option<i64>, _>(index) {
        return serde_json::Value::Number(number.into());
    }
    // float4 / float8
    if let Ok(Some(number)) = row.try_get::<Option<f32>, _>(index) {
        if let Some(number) = serde_json::Number::from_f64(f64::from(number)) {
            return serde_json::Value::Number(number);
        }
    }
    if let Ok(Some(number)) = row.try_get::<Option<f64>, _>(index) {
        if let Some(number) = serde_json::Number::from_f64(number) {
            return serde_json::Value::Number(number);
        }
    }
    if let Ok(Some(flag)) = row.try_get::<Option<bool>, _>(index) {
        return serde_json::Value::Bool(flag);
    }
    // bytea
    if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return serde_json::Value::String(format!("0x{}", hex_encode(&bytes)));
    }
    serde_json::Value::Null
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dbhub::driver::DialTarget;
    use crate::models::{DbConnection, DbReadOnlyPolicy};

    /// The Rust types `cell_to_json` asks a column to be, in the order it asks.
    ///
    /// Listed here as predicates rather than decoded as values, because what
    /// goes wrong is never a value — it is a *type* with no arm. `try_get`
    /// refuses a column whose SQL type does not match the Rust type being asked
    /// for, so a type nothing in the chain accepts falls out of the bottom as
    /// `NULL`, silently and looking exactly like a genuine null. That is how
    /// every `timestamp` and every `int4` in a result used to read as empty.
    ///
    /// Note how specific some of these are: `i64` is *not* compatible with
    /// `int4`, so the integer arms are one per width and dropping one drops a
    /// column type with it. The test below is what says so.
    fn arms() -> Vec<(&'static str, fn(&sqlx::postgres::PgTypeInfo) -> bool)> {
        use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
        use sqlx::{Postgres, Type};

        vec![
            ("text", <String as Type<Postgres>>::compatible),
            ("timestamp", <NaiveDateTime as Type<Postgres>>::compatible),
            ("timestamptz", <DateTime<Utc> as Type<Postgres>>::compatible),
            ("date", <NaiveDate as Type<Postgres>>::compatible),
            ("time", <NaiveTime as Type<Postgres>>::compatible),
            ("json", <serde_json::Value as Type<Postgres>>::compatible),
            ("uuid", <uuid::Uuid as Type<Postgres>>::compatible),
            ("numeric", <BigDecimal as Type<Postgres>>::compatible),
            ("int2", <i16 as Type<Postgres>>::compatible),
            ("int4", <i32 as Type<Postgres>>::compatible),
            ("int8", <i64 as Type<Postgres>>::compatible),
            ("float4", <f32 as Type<Postgres>>::compatible),
            ("float8", <f64 as Type<Postgres>>::compatible),
            ("bool", <bool as Type<Postgres>>::compatible),
            ("bytea", <Vec<u8> as Type<Postgres>>::compatible),
        ]
    }

    /// A column the grid is expected to be able to show. Add to this list when
    /// the decoder learns a type; this is what fails when it has not.
    const SHOWN: &[&str] = &[
        "text",
        "varchar",
        "bpchar",
        "name",
        "int2",
        "int4",
        "int8",
        "float4",
        "float8",
        "numeric",
        "bool",
        "bytea",
        "timestamp",
        "timestamptz",
        "date",
        "time",
        "json",
        "jsonb",
        "uuid",
    ];

    #[test]
    fn every_type_a_result_carries_has_an_arm_that_takes_it() {
        use sqlx::postgres::PgTypeInfo;

        let arms = arms();
        for name in SHOWN {
            let ty = PgTypeInfo::with_name(name);
            let taken = arms.iter().find(|(_, fits)| fits(&ty));
            assert!(
                taken.is_some(),
                "a {name} column would read as NULL — no arm in `cell_to_json` takes it"
            );
        }
    }

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
            auth_mode: crate::models::DbAuthMode::Manual,
            secret_arn: None,
            secret_name: None,
            sort_order: 0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn relations_sql_asks_only_for_the_kinds_wanted() {
        let sql = relations_sql("public", &[SchemaObject::Table]).expect("a query");
        assert!(sql.contains("table_type in ('BASE TABLE')"), "{sql}");

        let both =
            relations_sql("public", &[SchemaObject::Table, SchemaObject::View]).expect("a query");
        assert!(both.contains("'BASE TABLE', 'VIEW'"), "{both}");

        // Nothing to ask for means no round trip at all.
        assert!(relations_sql("public", &[SchemaObject::Procedure]).is_none());
    }

    #[test]
    fn relation_sql_quotes_the_schema_name() {
        // The schema name is a value, not a fragment: a quote in it must not
        // be able to end the literal.
        let sql = relations_sql("o'brien", &[SchemaObject::Table]).expect("a query");
        assert!(sql.contains("'o''brien'"), "{sql}");
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
