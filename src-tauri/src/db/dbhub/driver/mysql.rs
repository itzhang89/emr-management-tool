//! MySQL, over sqlx.
//!
//! Two things are MySQL's own and live here: how the wire is addressed
//! (`mysql_url`), and how the read-only promise is kept. MySQL has no
//! `BEGIN READ ONLY`, so read-only is a **session** property:
//! `SET SESSION TRANSACTION READ ONLY` must be issued *before* the statement
//! it governs, and every autocommit statement after it is refused if it
//! writes. The gate has already classified the statement (see `dbhub::gate`);
//! this is the second line of defence that actually runs on the server.

use async_trait::async_trait;
use bigdecimal::BigDecimal;
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::{MySqlPool, Row};

use crate::error::{AppError, AppResult};
use crate::models::DbConnectionKind;

use super::super::session::{self, QueryCancellation, CONNECT_TIMEOUT};
use super::{
    catalog_entries, hex_encode, DbCatalogEntry, DbDial, DbDriver, QueryPage, SchemaObject,
    ServerInfo, MAX_PAGE_ROWS,
};

/// The engine behind a MySQL connection.
pub struct MysqlDriver;

/// Databases the connected user can see.
const DATABASES_SQL: &str =
    "select schema_name as name, null as kind from information_schema.schemata";

/// Tables and views of one schema, for whichever of the two were asked for.
///
/// One query covers both: `information_schema.tables` already says which is
/// which, so a tree that shows only tables is filtering here rather than
/// fetching the views and dropping them.
fn relations_sql(schema: &str, kinds: &[SchemaObject]) -> Option<String> {
    let types: Vec<&str> = kinds
        .iter()
        .filter_map(|kind| match kind {
            SchemaObject::Table => Some("'BASE TABLE'"),
            SchemaObject::View => Some("'VIEW'"),
            _ => None,
        })
        .collect();
    (!types.is_empty()).then(|| {
        format!(
            "select table_name as name,              case table_type when 'VIEW' then 'view' else 'table' end as kind              from information_schema.tables where table_schema = {} and table_type in ({})              order by table_name",
            session::quote_literal(schema),
            types.join(", ")
        )
    })
}

/// Stored procedures and functions of one schema. One catalogue read covers
/// both, told apart by `routine_type`.
fn routines_sql(schema: &str, kinds: &[SchemaObject]) -> Option<String> {
    let types: Vec<&str> = kinds
        .iter()
        .filter_map(|kind| match kind {
            SchemaObject::Procedure => Some("'PROCEDURE'"),
            SchemaObject::Function => Some("'FUNCTION'"),
            _ => None,
        })
        .collect();
    (!types.is_empty()).then(|| {
        format!(
            "select routine_name as name,              case routine_type when 'PROCEDURE' then 'procedure' else 'function' end as kind              from information_schema.routines where routine_schema = {} and routine_type in ({})              order by routine_name",
            session::quote_literal(schema),
            types.join(", ")
        )
    })
}

/// Scheduled events of one schema.
fn events_sql(schema: &str) -> String {
    format!(
        "select event_name as name, 'event' as kind from information_schema.events          where event_schema = {} order by event_name",
        session::quote_literal(schema)
    )
}

#[async_trait]
impl DbDriver for MysqlDriver {
    fn kind(&self) -> DbConnectionKind {
        DbConnectionKind::Mysql
    }

    async fn initialize(&self, dial: &DbDial<'_>) -> AppResult<ServerInfo> {
        let pool = connect(dial).await?;
        let version = sqlx::query_scalar::<_, String>("select version()")
            .fetch_one(&pool)
            .await
            .map_err(|error| AppError::validation(session::describe_error(&error)));
        pool.close().await;
        Ok(ServerInfo { version: version? })
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

    /// MySQL has no level below the database: `information_schema` calls a
    /// schema what MySQL calls a database, and the tree's first level already
    /// lists those. Answering empty is how the tree is told to skip a level
    /// that would hold one meaningless choice.
    async fn list_schemas(&self, _dial: &DbDial<'_>) -> AppResult<Vec<DbCatalogEntry>> {
        Ok(Vec::new())
    }

    async fn list_objects(
        &self,
        dial: &DbDial<'_>,
        schema: &str,
        kinds: &[SchemaObject],
    ) -> AppResult<Vec<DbCatalogEntry>> {
        // MySQL reads a database's objects through `information_schema`, keyed
        // by that database's name — which the dial carries. `schema` is the
        // tree's third level, and MySQL has none, so it is empty here; the
        // dial's database is the only name that means anything.
        let database = if schema.is_empty() {
            dial.database().unwrap_or_default()
        } else {
            schema
        };
        let mut entries = Vec::new();
        // One catalogue read per kind asked for, and none for the kinds that
        // were not: a schema's thousand procedures stay off the path of
        // opening the tree on its tables.
        for sql in [
            relations_sql(database, kinds),
            routines_sql(database, kinds),
            kinds
                .contains(&SchemaObject::Event)
                .then(|| events_sql(database)),
        ]
        .into_iter()
        .flatten()
        {
            let page = read_page(dial, &sql, MAX_PAGE_ROWS, &QueryCancellation::never()).await?;
            entries.extend(catalog_entries(&page));
        }
        Ok(entries)
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

/// Build a MySQL connection URL for this dial.
pub(crate) fn mysql_url(dial: &DbDial<'_>) -> String {
    // No database named → no path segment; MySQL connects to the server and
    // the query names its schema explicitly.
    session::scheme_url("mysql", dial, dial.database())
}

/// Open a one-connection pool. A query tab fires at human cadence, so pooling
/// across calls is an optimisation to make later, not now.
async fn connect(dial: &DbDial<'_>) -> AppResult<MySqlPool> {
    sqlx::mysql::MySqlPoolOptions::new()
        .acquire_timeout(CONNECT_TIMEOUT)
        .max_connections(1)
        .connect(&mysql_url(dial))
        .await
        .map_err(|error| session::dial_error(dial, &error))
}

/// One statement through a session pinned read-only, at most `cap` rows.
async fn read_page(
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

    // Skipped for a connection the user opened up: the session is the second
    // line of defence behind the gate, and there is nothing left to defend
    // once the gate itself has been waived.
    if !dial.writable {
        sqlx::query("set session transaction read only")
            .execute(&mut *conn)
            .await
            .map_err(|error| AppError::validation(session::describe_error(&error)))?;
    }

    let rows = session::fetch_capped(
        sqlx::query(sqlx::AssertSqlSafe(sql.to_string())),
        &mut *conn,
        cap,
        cancel,
    )
    .await;

    // The connection must be back in the pool before it can be closed — a
    // checked-out connection is a permit `close()` waits on.
    drop(conn);
    pool.close().await;

    Ok(session::project(&rows?, cap, cell_to_json))
}

/// Decode one MySQL cell into a JSON value.
///
/// sqlx provides no `Decode for serde_json::Value` on MySQL (only the `Json<T>`
/// wrapper), so a blanket `try_get::<serde_json::Value>` always errors — and
/// swallowing that error is how MySQL results once came back all-blank with no
/// error in sight. Decode by value type instead: numbers and booleans keep
/// their JSON shapes, text and temporal values become strings, NULL stays
/// null, and anything that cannot be decoded as one of those (a binary blob)
/// renders as its `0x…` marker rather than silently vanishing.
///
/// The chain is a search for the type that fits, because `try_get` refuses a
/// column whose SQL type does not match the Rust type being asked for — see
/// `Row::try_get`, which checks `T::compatible` before it decodes. Two of those
/// checks are narrower than they look, and both cost a column its value:
/// `i64` turns down an *unsigned* integer, and `f64` turns down a `decimal`,
/// which is a deliberate refusal to round somebody's money.
///
/// The temporal arms are the ones that were missing. `DATETIME`, `TIMESTAMP`,
/// `DATE` and `TIME` are none of them text as far as sqlx is concerned, so a
/// date column failed every arm above and fell out of the bottom as `NULL` —
/// silently, and looking exactly like a real null. `DATETIME` and `TIMESTAMP`
/// are separate types here, which is why they have an arm each.
fn cell_to_json(row: &sqlx::mysql::MySqlRow, index: usize) -> serde_json::Value {
    // Text first covers VARCHAR/TEXT/CHAR/ENUM/SET.
    if let Ok(Some(text)) = row.try_get::<Option<String>, _>(index) {
        return serde_json::Value::String(text);
    }
    if let Ok(Some(text)) = row.try_get::<Option<&str>, _>(index) {
        return serde_json::Value::String(text.to_string());
    }
    // datetime
    if let Ok(Some(at)) = row.try_get::<Option<NaiveDateTime>, _>(index) {
        return serde_json::Value::String(at.to_string());
    }
    // timestamp
    if let Ok(Some(at)) = row.try_get::<Option<DateTime<Utc>>, _>(index) {
        return serde_json::Value::String(at.to_rfc3339());
    }
    // date
    if let Ok(Some(day)) = row.try_get::<Option<NaiveDate>, _>(index) {
        return serde_json::Value::String(day.to_string());
    }
    // time, as long as it is a time of day
    if let Ok(Some(at)) = row.try_get::<Option<NaiveTime>, _>(index) {
        return serde_json::Value::String(at.to_string());
    }
    // …and once it is not: MySQL's `TIME` is also an interval, and runs from
    // -838:59:59 to 838:59:59, which no clock reading can hold.
    if let Ok(Some(span)) = row.try_get::<Option<Duration>, _>(index) {
        return serde_json::Value::String(clock_text(span));
    }
    // json
    if let Ok(Some(document)) = row.try_get::<Option<serde_json::Value>, _>(index) {
        return document;
    }
    // decimal — as the digits the column holds rather than as a float
    if let Ok(Some(number)) = row.try_get::<Option<BigDecimal>, _>(index) {
        return serde_json::Value::String(number.to_string());
    }
    // unsigned ints, which the signed arm below will not take
    if let Ok(Some(number)) = row.try_get::<Option<u64>, _>(index) {
        return serde_json::Value::Number(number.into());
    }
    if let Ok(Some(number)) = row.try_get::<Option<i64>, _>(index) {
        return serde_json::Value::Number(number.into());
    }
    // float / double
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
    if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return serde_json::Value::String(format!("0x{}", hex_encode(&bytes)));
    }
    serde_json::Value::Null
}

/// An interval as `hh:mm:ss`, signed — the shape MySQL itself prints a `time`
/// column in, so a value read out of the grid looks like the value in the
/// table.
fn clock_text(span: Duration) -> String {
    let sign = if span < Duration::zero() { "-" } else { "" };
    let seconds = span.num_seconds().abs();
    format!(
        "{sign}{:02}:{:02}:{:02}",
        seconds / 3600,
        (seconds / 60) % 60,
        seconds % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dbhub::driver::DialTarget;
    use crate::models::{DbConnection, DbReadOnlyPolicy};

    #[test]
    fn a_time_past_a_day_is_written_the_way_mysql_wrote_it() {
        // MySQL's `time` is not a clock reading — it is a signed interval that
        // runs well past 24 hours, and the grid should show the column the way
        // the table does rather than refusing it or wrapping it round.
        assert_eq!(clock_text(Duration::hours(25)), "25:00:00");
        assert_eq!(clock_text(Duration::seconds(-3661)), "-01:01:01");
        assert_eq!(clock_text(Duration::zero()), "00:00:00");
        assert_eq!(clock_text(Duration::seconds(838 * 3600 + 59 * 60 + 59)), "838:59:59");
    }

    fn connection() -> DbConnection {
        DbConnection {
            id: "c1".into(),
            account_id: "acct-a".into(),
            kind: DbConnectionKind::Mysql,
            name: "Test".into(),
            host: "db.internal".into(),
            port: 3306,
            database: Some("sales db".into()),
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
    fn url_percent_encodes_user_pieces() {
        let connection = connection();
        let target = DialTarget::direct(&connection);
        let dial = DbDial::new(&connection, &target, Some("p@ss/word"));
        // The spaces in user/database and the @ / in the password must not
        // change the URL's structure — everything rides in percent-encoded.
        assert!(mysql_url(&dial)
            .starts_with("mysql://bi%20reader:p%40ss%2Fword@db.internal:3306/sales%20db"));
    }

    #[test]
    fn url_omits_database_segment_when_none_is_named() {
        let mut connection = connection();
        connection.database = None;
        let target = DialTarget::direct(&connection);
        let dial = DbDial::new(&connection, &target, None);
        let url = mysql_url(&dial);
        assert!(!url.ends_with('/'));
        assert_eq!(url, "mysql://bi%20reader:@db.internal:3306");
    }

    #[tokio::test]
    async fn initialize_reports_a_readable_error_for_an_unreachable_host() {
        // Port 1 on loopback is closed — the dial fails fast and the error is
        // projected into a short message, not a driver dump.
        let mut connection = connection();
        connection.host = "127.0.0.1".into();
        connection.port = 1;
        let target = DialTarget::direct(&connection);
        let dial = DbDial::new(&connection, &target, Some("wrong"));
        let error = MysqlDriver
            .initialize(&dial)
            .await
            .expect_err("the dial must fail");
        // The message names what was dialed and how — a bare errno leaves the
        // reader guessing whether a tunnel was even involved.
        assert!(
            error
                .message
                .starts_with("Could not reach 127.0.0.1:1 (direct):"),
            "{error:?}"
        );
        assert!(error.message.len() <= 300);
    }
}
