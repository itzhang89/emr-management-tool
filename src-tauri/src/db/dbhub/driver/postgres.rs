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
    catalog_entries, column_entries, hex_encode, json_bool_yes_no, json_i64, json_str,
    DbCatalogEntry, DbColumnEntry, DbDial, DbDriver, DbTableColumn, DbTableDetail, DbTableIndex,
    QueryPage, SchemaObject, ServerInfo, MAX_PAGE_ROWS,
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

    async fn list_columns(
        &self,
        dial: &DbDial<'_>,
        schema: &str,
        table: &str,
    ) -> AppResult<Vec<DbColumnEntry>> {
        list_columns(dial, schema, table).await
    }

    async fn describe_table(
        &self,
        dial: &DbDial<'_>,
        schema: &str,
        table: &str,
    ) -> AppResult<DbTableDetail> {
        describe_table(dial, schema, table).await
    }

    async fn update_table_metadata(
        &self,
        dial: &DbDial<'_>,
        schema: &str,
        table: &str,
        comment: Option<&str>,
        column_comments: &[(String, Option<String>)],
    ) -> AppResult<()> {
        update_table_metadata(dial, schema, table, comment, column_comments).await
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

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn pg_table_props_sql(schema: &str, table: &str) -> String {
    format!(
        "select c.relkind::text as relkind, \
                obj_description(c.oid) as comment, \
                c.reltuples::bigint as row_estimate, \
                pg_catalog.pg_total_relation_size(c.oid)::bigint as data_length, \
                n.nspname as schema_name \
         from pg_catalog.pg_class c \
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
         where n.nspname = {} and c.relname = {} \
         and c.relkind in ('r','p','v','m','f')",
        session::quote_literal(schema),
        session::quote_literal(table)
    )
}

fn pg_rich_columns_sql(schema: &str, table: &str) -> String {
    format!(
        "select a.attname as name, \
                pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type, \
                not a.attnotnull as is_nullable, \
                pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) as column_default, \
                col_description(a.attrelid, a.attnum) as comment, \
                a.attnum::bigint as ordinal, \
                case when EXISTS ( \
                    select 1 from pg_catalog.pg_index i \
                    where i.indrelid = a.attrelid and a.attnum = any(i.indkey) and i.indisprimary \
                ) then 'PRI' else null end as column_key, \
                case when a.attidentity <> '' then 'identity' \
                     when a.attgenerated <> '' then 'generated' \
                     else null end as extra \
         from pg_catalog.pg_attribute a \
         join pg_catalog.pg_class c on c.oid = a.attrelid \
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
         left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum \
         where n.nspname = {} and c.relname = {} \
           and a.attnum > 0 and not a.attisdropped \
         order by a.attnum",
        session::quote_literal(schema),
        session::quote_literal(table)
    )
}

fn pg_indexes_sql(schema: &str, table: &str) -> String {
    format!(
        "select i.relname as index_name, \
                ix.indisunique as is_unique, \
                a.attname as column_name, \
                array_position(ix.indkey, a.attnum) as seq, \
                am.amname as index_type \
         from pg_catalog.pg_class t \
         join pg_catalog.pg_namespace n on n.oid = t.relnamespace \
         join pg_catalog.pg_index ix on t.oid = ix.indrelid \
         join pg_catalog.pg_class i on i.oid = ix.indexrelid \
         join pg_catalog.pg_am am on am.oid = i.relam \
         join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum = any(ix.indkey) \
         where n.nspname = {} and t.relname = {} \
         order by i.relname, seq",
        session::quote_literal(schema),
        session::quote_literal(table)
    )
}

pub(crate) async fn describe_table(
    dial: &DbDial<'_>,
    schema: &str,
    table: &str,
) -> AppResult<DbTableDetail> {
    let database = dial.database().unwrap_or("postgres").to_string();
    let props = read_page(
        dial,
        &pg_table_props_sql(schema, table),
        1,
        &QueryCancellation::never(),
    )
    .await?;
    let props_row = props.rows.first().cloned();

    let columns_page = read_page(
        dial,
        &pg_rich_columns_sql(schema, table),
        MAX_PAGE_ROWS,
        &QueryCancellation::never(),
    )
    .await?;
    let columns: Vec<DbTableColumn> = columns_page
        .rows
        .iter()
        .filter_map(|row| {
            Some(DbTableColumn {
                name: json_str(row, "name")?,
                data_type: json_str(row, "data_type").unwrap_or_else(|| "unknown".into()),
                nullable: json_bool_yes_no(row, "is_nullable")
                    .or_else(|| row.get("is_nullable").and_then(|v| v.as_bool())),
                default_value: json_str(row, "column_default"),
                comment: json_str(row, "comment"),
                ordinal: json_i64(row, "ordinal"),
                column_key: json_str(row, "column_key"),
                extra: json_str(row, "extra"),
            })
        })
        .collect();

    let indexes = match read_page(
        dial,
        &pg_indexes_sql(schema, table),
        MAX_PAGE_ROWS,
        &QueryCancellation::never(),
    )
    .await
    {
        Ok(page) => fold_pg_indexes(&page),
        Err(_) => Vec::new(),
    };

    let relkind = props_row
        .as_ref()
        .and_then(|row| json_str(row, "relkind"))
        .unwrap_or_default();
    let (object_kind, table_type) = match relkind.as_str() {
        "v" => (Some(SchemaObject::View), Some("VIEW".into())),
        "m" => (
            Some(SchemaObject::MaterializedView),
            Some("MATERIALIZED VIEW".into()),
        ),
        "f" => (Some(SchemaObject::ForeignTable), Some("FOREIGN TABLE".into())),
        "p" => (Some(SchemaObject::Table), Some("PARTITIONED TABLE".into())),
        _ => (Some(SchemaObject::Table), Some("BASE TABLE".into())),
    };

    let qualified = format!("{}.{}", quote_ident(schema), quote_ident(table));
    let regclass = format!("{schema}.{table}");
    let ddl = match relkind.as_str() {
        "v" | "m" => {
            let def = read_page(
                dial,
                &format!(
                    "select pg_catalog.pg_get_viewdef({}::regclass, true) as ddl",
                    session::quote_literal(&regclass)
                ),
                1,
                &QueryCancellation::never(),
            )
            .await
            .ok()
            .and_then(|page| page.rows.first().and_then(|row| json_str(row, "ddl")));
            def.map(|body| {
                let kind = if relkind == "m" {
                    "MATERIALIZED VIEW"
                } else {
                    "VIEW"
                };
                format!("CREATE {kind} {qualified} AS\n{body}")
            })
        }
        _ => Some(reconstruct_create_table(&qualified, &columns, &indexes)),
    };

    Ok(DbTableDetail {
        database,
        schema: Some(schema.to_string()),
        name: table.to_string(),
        object_kind,
        table_type,
        engine: None,
        collation: None,
        comment: props_row.as_ref().and_then(|row| json_str(row, "comment")),
        row_estimate: props_row
            .as_ref()
            .and_then(|row| json_i64(row, "row_estimate"))
            .map(|n| n.max(0)),
        data_length: props_row.as_ref().and_then(|row| json_i64(row, "data_length")),
        create_time: None,
        update_time: None,
        columns,
        indexes,
        ddl,
        properties: std::collections::BTreeMap::new(),
    })
}

fn fold_pg_indexes(page: &QueryPage) -> Vec<DbTableIndex> {
    let mut order: Vec<String> = Vec::new();
    let mut by_name: std::collections::BTreeMap<String, DbTableIndex> =
        std::collections::BTreeMap::new();
    for row in &page.rows {
        let name = match json_str(row, "index_name") {
            Some(name) => name,
            None => continue,
        };
        let column = match json_str(row, "column_name") {
            Some(column) => column,
            None => continue,
        };
        let unique = row
            .get("is_unique")
            .and_then(|v| v.as_bool())
            .or_else(|| json_bool_yes_no(row, "is_unique"))
            .unwrap_or(false);
        let index_type = json_str(row, "index_type");
        if let Some(existing) = by_name.get_mut(&name) {
            if !existing.columns.contains(&column) {
                existing.columns.push(column);
            }
        } else {
            order.push(name.clone());
            by_name.insert(
                name.clone(),
                DbTableIndex {
                    name,
                    columns: vec![column],
                    unique,
                    index_type,
                },
            );
        }
    }
    order
        .into_iter()
        .filter_map(|name| by_name.remove(&name))
        .collect()
}

fn reconstruct_create_table(
    qualified: &str,
    columns: &[DbTableColumn],
    indexes: &[DbTableIndex],
) -> String {
    let mut lines: Vec<String> = columns
        .iter()
        .map(|column| {
            let mut line = format!("  {} {}", quote_ident(&column.name), column.data_type);
            if column.nullable == Some(false) {
                line.push_str(" NOT NULL");
            }
            if let Some(default) = column.default_value.as_deref() {
                line.push_str(" DEFAULT ");
                line.push_str(default);
            }
            line
        })
        .collect();
    if let Some(pk) = indexes.iter().find(|index| {
        index.unique
            && (index.name.ends_with("_pkey") || index.name == "PRIMARY")
    }) {
        let cols = pk
            .columns
            .iter()
            .map(|name| quote_ident(name))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("  PRIMARY KEY ({cols})"));
    }
    format!("CREATE TABLE {qualified} (\n{}\n);", lines.join(",\n"))
}

pub(crate) async fn update_table_metadata(
    dial: &DbDial<'_>,
    schema: &str,
    table: &str,
    comment: Option<&str>,
    column_comments: &[(String, Option<String>)],
) -> AppResult<()> {
    if !dial.writable {
        return Err(AppError::validation(
            "Saving table metadata needs Allow writes on this connection.",
        ));
    }
    let qualified = format!("{}.{}", quote_ident(schema), quote_ident(table));
    let pool = connect(dial).await?;
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| AppError::validation(session::describe_error(&error)))?;

    if let Some(text) = comment {
        let sql = format!(
            "comment on table {qualified} is {}",
            session::quote_literal(text)
        );
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut *conn)
            .await
            .map_err(|error| AppError::validation(session::describe_error(&error)))?;
    }

    for (name, new_comment) in column_comments {
        let comment_sql = match new_comment {
            Some(text) => session::quote_literal(text),
            None => "NULL".to_string(),
        };
        let sql = format!(
            "comment on column {qualified}.{} is {comment_sql}",
            quote_ident(name)
        );
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut *conn)
            .await
            .map_err(|error| AppError::validation(session::describe_error(&error)))?;
    }

    drop(conn);
    pool.close().await;
    Ok(())
}

fn columns_sql(schema: &str, table: &str) -> String {
    format!(
        "select column_name as name, data_type as data_type \
         from information_schema.columns \
         where table_schema = {} and table_name = {} \
         order by ordinal_position",
        session::quote_literal(schema),
        session::quote_literal(table)
    )
}

pub(crate) async fn list_columns(
    dial: &DbDial<'_>,
    schema: &str,
    table: &str,
) -> AppResult<Vec<DbColumnEntry>> {
    let page = read_page(
        dial,
        &columns_sql(schema, table),
        MAX_PAGE_ROWS,
        &QueryCancellation::never(),
    )
    .await?;
    Ok(column_entries(&page))
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
