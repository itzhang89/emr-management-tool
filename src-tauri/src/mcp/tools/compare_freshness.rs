//! Metadata freshness compare across two DBHub connections (source ↔ warehouse).
//!
//! Reads only: `COUNT(*)` and optional `MAX(watermark)` on each side, then
//! reports lag vs a tolerance. Table/column names must be simple identifiers —
//! no quoting tricks, no joins, no user-supplied SQL.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db::dbhub::session::QueryCancellation;
use crate::db::dbhub::{query, tunnel};
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::mcp::tools::dbhub_sql::{self, connection_slug};
use crate::models::{DbConnection, DbConnectionKind};

const DEFAULT_TOLERANCE_SECONDS: i64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompareTableFreshnessArgs {
    /// DBHub connection id for the source side (preferred when known).
    #[serde(default)]
    pub source_connection_id: Option<String>,
    /// Connection display-name slug or `execute_sql_<slug>` tool name.
    #[serde(default)]
    pub source_tool_slug: Option<String>,
    #[serde(default)]
    pub target_connection_id: Option<String>,
    #[serde(default)]
    pub target_tool_slug: Option<String>,
    pub source_table: String,
    pub target_table: String,
    #[serde(default)]
    pub source_schema: Option<String>,
    #[serde(default)]
    pub target_schema: Option<String>,
    /// Column used for `MAX(...)` freshness. When omitted, only row counts run.
    #[serde(default)]
    pub watermark_column: Option<String>,
    /// Allowed absolute lag in seconds between the two MAX(watermark) values.
    #[serde(default)]
    pub tolerance_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SideFreshness {
    pub connection_id: String,
    pub connection_name: String,
    pub kind: String,
    pub qualified_table: String,
    pub row_count: Option<i64>,
    pub max_watermark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareTableFreshnessResult {
    pub ok: bool,
    #[serde(rename = "match")]
    pub matched: bool,
    pub tolerance_seconds: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lag_seconds: Option<i64>,
    pub counts_match: Option<bool>,
    pub source: SideFreshness,
    pub target: SideFreshness,
    pub notes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CompareTableFreshnessResult {
    pub fn refused(message: &str) -> Self {
        Self {
            ok: false,
            matched: false,
            tolerance_seconds: DEFAULT_TOLERANCE_SECONDS,
            lag_seconds: None,
            counts_match: None,
            source: empty_side("source"),
            target: empty_side("target"),
            notes: Vec::new(),
            error: Some(message.to_string()),
        }
    }
}

fn empty_side(label: &str) -> SideFreshness {
    SideFreshness {
        connection_id: String::new(),
        connection_name: label.to_string(),
        kind: String::new(),
        qualified_table: String::new(),
        row_count: None,
        max_watermark: None,
        error: None,
    }
}

pub async fn compare_table_freshness(
    app: &AppHandle,
    args: &CompareTableFreshnessArgs,
) -> AppResult<CompareTableFreshnessResult> {
    compare_table_freshness_inner(app, args).await
}

async fn compare_table_freshness_inner(
    app: &AppHandle,
    args: &CompareTableFreshnessArgs,
) -> AppResult<CompareTableFreshnessResult> {
    let tolerance = args
        .tolerance_seconds
        .unwrap_or(DEFAULT_TOLERANCE_SECONDS)
        .clamp(0, 7 * 24 * 3600);

    let source_conn = resolve_side(
        args.source_connection_id.as_deref(),
        args.source_tool_slug.as_deref(),
        "source",
    )
    .await?;
    let target_conn = resolve_side(
        args.target_connection_id.as_deref(),
        args.target_tool_slug.as_deref(),
        "target",
    )
    .await?;

    let source_table = qualify_table(
        source_conn.kind,
        args.source_schema.as_deref(),
        &args.source_table,
    )?;
    let target_table = qualify_table(
        target_conn.kind,
        args.target_schema.as_deref(),
        &args.target_table,
    )?;

    let watermark = args
        .watermark_column
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty());
    if let Some(column) = watermark {
        validate_ident(column, "watermark column")?;
    }

    let mut notes = Vec::new();
    if watermark.is_none() {
        notes.push(
            "No watermarkColumn provided — comparing row counts only.".to_string(),
        );
    }

    let source = probe_side(app, &source_conn, &source_table, watermark).await;
    let target = probe_side(app, &target_conn, &target_table, watermark).await;

    if let Some(error) = source.error.as_ref() {
        notes.push(format!("Source probe failed: {error}"));
    }
    if let Some(error) = target.error.as_ref() {
        notes.push(format!("Target probe failed: {error}"));
    }

    let counts_match = match (source.row_count, target.row_count) {
        (Some(a), Some(b)) => Some(a == b),
        _ => None,
    };

    let lag_seconds = match (
        source.max_watermark.as_deref(),
        target.max_watermark.as_deref(),
    ) {
        (Some(a), Some(b)) => lag_seconds_between(a, b),
        _ => None,
    };
    if watermark.is_some() && lag_seconds.is_none() && source.error.is_none() && target.error.is_none()
    {
        notes.push(
            "Could not parse both watermarks as timestamps — lag not computed.".to_string(),
        );
    }

    let freshness_ok = match lag_seconds {
        Some(lag) => lag.abs() <= tolerance,
        None => watermark.is_none(),
    };
    let counts_ok = counts_match.unwrap_or(true);
    let probes_ok = source.error.is_none() && target.error.is_none();
    let matched = probes_ok && counts_ok && freshness_ok;

    if !probes_ok {
        notes.push("One or both sides failed — treat match as false.".into());
    } else if !matched {
        if counts_match == Some(false) {
            notes.push(format!(
                "Row counts differ (source={}, target={}).",
                source.row_count.unwrap_or_default(),
                target.row_count.unwrap_or_default()
            ));
        }
        if let Some(lag) = lag_seconds {
            if lag.abs() > tolerance {
                notes.push(format!(
                    "Watermark lag is {lag}s (tolerance {tolerance}s)."
                ));
            }
        }
        notes.push(
            "Mismatch: use Glue/EMR tools and match_runbooks to attribute root cause. Do not repair data automatically."
                .into(),
        );
    }

    Ok(CompareTableFreshnessResult {
        ok: probes_ok,
        matched,
        tolerance_seconds: tolerance,
        lag_seconds,
        counts_match,
        source,
        target,
        notes,
        error: None,
    })
}

async fn resolve_side(
    connection_id: Option<&str>,
    tool_slug: Option<&str>,
    label: &str,
) -> AppResult<DbConnection> {
    if let Some(id) = connection_id.map(str::trim).filter(|text| !text.is_empty()) {
        let pool = repository::pool().await?;
        let account_id = repository::active_aws_account(&pool)
            .await?
            .map(|account| account.id)
            .ok_or_else(|| {
                AppError::validation("No active AWS account. Configure one in Settings first.")
            })?;
        let connection = crate::db::dbhub::get_connection(&pool, &account_id, id)
            .await?
            .ok_or_else(|| {
                AppError::validation(format!(
                    "{label} connection was not found in the active account."
                ))
            })?;
        if !connection.enabled_for_ai {
            return Err(AppError::validation(format!(
                "{label} connection is not enabled for AI. Enable it on the DBHub Overview card."
            )));
        }
        return Ok(connection);
    }

    let raw = tool_slug
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| {
            AppError::validation(format!(
                "Provide {label}ConnectionId or {label}ToolSlug (e.g. execute_sql_bigdata_etl)."
            ))
        })?;
    let slug = normalize_tool_slug(raw)?;
    dbhub_sql::resolve_connection_by_slug(&slug).await
}

fn normalize_tool_slug(raw: &str) -> AppResult<String> {
    let trimmed = raw
        .trim()
        .strip_prefix(dbhub_sql::EXECUTE_SQL_PREFIX)
        .unwrap_or(raw.trim());
    let slug = connection_slug(trimmed);
    if slug.is_empty() {
        return Err(AppError::validation(format!("Invalid tool slug `{raw}`.")));
    }
    Ok(slug)
}

fn validate_ident(value: &str, label: &str) -> AppResult<()> {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(AppError::validation(format!("{label} is required.")));
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(AppError::validation(format!(
            "{label} must start with a letter or underscore."
        )));
    }
    if !chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
        return Err(AppError::validation(format!(
            "{label} may only contain letters, digits, and underscores."
        )));
    }
    if value.len() > 128 {
        return Err(AppError::validation(format!("{label} is too long.")));
    }
    Ok(())
}

fn quote_ident(kind: DbConnectionKind, ident: &str) -> String {
    match kind {
        DbConnectionKind::Mysql => format!("`{ident}`"),
        DbConnectionKind::Postgres | DbConnectionKind::Yellowbrick => format!("\"{ident}\""),
    }
}

fn qualify_table(
    kind: DbConnectionKind,
    schema: Option<&str>,
    table: &str,
) -> AppResult<String> {
    let table = table.trim();
    validate_ident(table, "table name")?;
    let table_sql = quote_ident(kind, table);
    match schema.map(str::trim).filter(|text| !text.is_empty()) {
        Some(schema) => {
            validate_ident(schema, "schema name")?;
            Ok(format!("{}.{}", quote_ident(kind, schema), table_sql))
        }
        None => Ok(table_sql),
    }
}

async fn probe_side(
    app: &AppHandle,
    connection: &DbConnection,
    qualified_table: &str,
    watermark: Option<&str>,
) -> SideFreshness {
    let mut side = SideFreshness {
        connection_id: connection.id.clone(),
        connection_name: connection.name.clone(),
        kind: connection.kind.as_str().to_string(),
        qualified_table: qualified_table.to_string(),
        row_count: None,
        max_watermark: None,
        error: None,
    };

    let shape = match shape_for(app, connection).await {
        Ok(shape) => shape,
        Err(error) => {
            side.error = Some(error.message.to_string());
            return side;
        }
    };

    let (target, _forward) = match tunnel::dial_target_for(&shape.pool, app, &shape.connection).await
    {
        Ok(route) => route,
        Err(error) => {
            side.error = Some(error.message.to_string());
            return side;
        }
    };

    let count_sql = format!("SELECT COUNT(*) AS row_count FROM {qualified_table}");
    match query::execute(
        &shape,
        &target,
        &count_sql,
        1,
        0,
        false,
        &QueryCancellation::never(),
    )
    .await
    {
        Ok(result) => {
            side.row_count = result
                .rows
                .first()
                .and_then(|row| row.get("row_count").or_else(|| row.get("ROW_COUNT")))
                .and_then(json_i64);
        }
        Err(error) => {
            side.error = Some(error.message.to_string());
            return side;
        }
    }

    if let Some(column) = watermark {
        let column_sql = quote_ident(connection.kind, column);
        let max_sql =
            format!("SELECT MAX({column_sql}) AS max_watermark FROM {qualified_table}");
        match query::execute(
            &shape,
            &target,
            &max_sql,
            1,
            0,
            false,
            &QueryCancellation::never(),
        )
        .await
        {
            Ok(result) => {
                side.max_watermark = result
                    .rows
                    .first()
                    .and_then(|row| row.get("max_watermark").or_else(|| row.get("MAX_WATERMARK")))
                    .and_then(json_string);
            }
            Err(error) => {
                side.error = Some(error.message.to_string());
            }
        }
    }

    side
}

async fn shape_for(
    app: &AppHandle,
    connection: &DbConnection,
) -> AppResult<query::DbConnectionShape> {
    let password =
        crate::secrets::read_optional_secret(app, &format!("db/{}/password", connection.id))
            .unwrap_or(None);
    Ok(query::DbConnectionShape {
        pool: repository::pool().await?,
        connection: connection.clone(),
        password,
    })
}

fn json_i64(value: &serde_json::Value) -> Option<i64> {
    match value {
        serde_json::Value::Number(number) => number.as_i64().or_else(|| {
            number.as_f64().map(|float| float as i64)
        }),
        serde_json::Value::String(text) => text.parse().ok(),
        _ => None,
    }
}

fn json_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => Some(text.clone()),
        other => Some(other.to_string().trim_matches('"').to_string()),
    }
}

/// Absolute lag in seconds between two watermark strings. Accepts RFC3339 and
/// common SQL datetime forms (`YYYY-MM-DD HH:MM:SS`).
pub fn lag_seconds_between(a: &str, b: &str) -> Option<i64> {
    let left = parse_watermark(a)?;
    let right = parse_watermark(b)?;
    Some((left - right).num_seconds())
}

fn parse_watermark(text: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let text = text.trim();
    if let Ok(value) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(value.with_timezone(&chrono::Utc));
    }
    if let Ok(value) = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S") {
        return Some(value.and_utc());
    }
    if let Ok(value) = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S") {
        return Some(value.and_utc());
    }
    if let Ok(value) = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        return Some(value.and_hms_opt(0, 0, 0)?.and_utc());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lag_math_uses_absolute_difference_direction() {
        let lag = lag_seconds_between("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z").unwrap();
        assert_eq!(lag, 86400);
        let reverse = lag_seconds_between("2026-01-01 00:00:00", "2026-01-02 00:00:00").unwrap();
        assert_eq!(reverse, -86400);
    }

    #[test]
    fn reject_unsafe_identifiers() {
        assert!(validate_ident("orders", "table").is_ok());
        assert!(validate_ident("updated_at", "col").is_ok());
        assert!(validate_ident("orders;drop", "table").is_err());
        assert!(validate_ident("a.b", "table").is_err());
        assert!(qualify_table(DbConnectionKind::Mysql, None, "orders").is_ok());
        assert!(qualify_table(DbConnectionKind::Mysql, Some("sales"), "orders").is_ok());
        let q = qualify_table(DbConnectionKind::Yellowbrick, Some("public"), "fact_sales").unwrap();
        assert_eq!(q, "\"public\".\"fact_sales\"");
    }

    #[test]
    fn normalize_accepts_tool_prefix_and_display_name() {
        assert_eq!(
            normalize_tool_slug("execute_sql_bigdata_etl").unwrap(),
            "bigdata_etl"
        );
        assert_eq!(normalize_tool_slug("MySQL-Prod").unwrap(), "mysql_prod");
    }

    #[test]
    fn refused_result_marks_not_ok() {
        let refused = CompareTableFreshnessResult::refused("nope");
        assert!(!refused.ok);
        assert_eq!(refused.error.as_deref(), Some("nope"));
    }
}
