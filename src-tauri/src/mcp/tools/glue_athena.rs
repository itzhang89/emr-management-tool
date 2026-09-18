//! Read-only Glue Catalog + Athena SQL tools for Chat / external agents.
//!
//! These sit on the active AWS account (no JDBC connection id). Writes such as
//! `update_glue_*` and Athena DDL are never exposed here; Athena statements
//! also pass the DBHub read-only gate before `StartQueryExecution`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::{athena, glue};
use crate::db::dbhub::gate::{self, StatementClass};
use crate::error::{AppError, AppResult};
use crate::models::{
    AthenaQueryExecutionRequest, AthenaQueryResultsRequest, AthenaWorkgroup, AwsCommandContext,
    GlueGetTableRequest, GlueListRequest, GlueTableDetail, StartAthenaQueryRequest,
};

const TOOL_MAX_ROWS: i32 = 100;
const POLL_INTERVAL_MS: u64 = 1_000;
const POLL_TIMEOUT_SECS: u64 = 120;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListGlueDatabasesArgs {
    #[serde(default)]
    pub next_token: Option<String>,
    #[serde(default)]
    pub max_results: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListGlueTablesArgs {
    pub database_name: String,
    #[serde(default)]
    pub next_token: Option<String>,
    #[serde(default)]
    pub max_results: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetGlueTableArgs {
    pub database_name: String,
    pub table_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListAthenaWorkgroupsArgs {}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteAthenaSqlArgs {
    pub sql: String,
    pub workgroup: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub output_location: Option<String>,
    #[serde(default)]
    pub max_rows: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteAthenaSqlResult {
    pub query_execution_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Vec<String>>>,
    pub returned_rows: usize,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ExecuteAthenaSqlResult {
    pub fn refused(sql: &str, message: &str) -> Self {
        let _ = sql;
        Self {
            query_execution_id: String::new(),
            state: "REFUSED".into(),
            columns: None,
            rows: None,
            returned_rows: 0,
            truncated: false,
            next_token: None,
            note: None,
            error: Some(message.to_string()),
        }
    }
}

pub async fn list_glue_databases(
    app: &AppHandle,
    args: &ListGlueDatabasesArgs,
) -> AppResult<serde_json::Value> {
    let response = glue::list_glue_databases(
        app.clone(),
        GlueListRequest {
            account_id: None,
            catalog_id: None,
            database_name: None,
            next_token: args.next_token.clone(),
            max_results: Some(args.max_results.unwrap_or(100).clamp(1, 100)),
        },
    )
    .await?;
    Ok(serde_json::to_value(response).unwrap_or_default())
}

pub async fn list_glue_tables(
    app: &AppHandle,
    args: &ListGlueTablesArgs,
) -> AppResult<serde_json::Value> {
    if args.database_name.trim().is_empty() {
        return Err(AppError::validation("databaseName is required."));
    }
    let response = glue::list_glue_tables(
        app.clone(),
        GlueListRequest {
            account_id: None,
            catalog_id: None,
            database_name: Some(args.database_name.clone()),
            next_token: args.next_token.clone(),
            max_results: Some(args.max_results.unwrap_or(100).clamp(1, 100)),
        },
    )
    .await?;
    Ok(serde_json::to_value(response).unwrap_or_default())
}

pub async fn get_glue_table(
    app: &AppHandle,
    args: &GetGlueTableArgs,
) -> AppResult<GlueTableDetail> {
    if args.database_name.trim().is_empty() || args.table_name.trim().is_empty() {
        return Err(AppError::validation(
            "databaseName and tableName are required.",
        ));
    }
    glue::get_glue_table(
        app.clone(),
        GlueGetTableRequest {
            account_id: None,
            catalog_id: None,
            database_name: args.database_name.clone(),
            table_name: args.table_name.clone(),
        },
    )
    .await
}

pub async fn list_athena_workgroups(app: &AppHandle) -> AppResult<Vec<AthenaWorkgroup>> {
    athena::list_athena_workgroups(app.clone(), AwsCommandContext { account_id: None }).await
}

pub async fn execute_athena_sql(
    app: &AppHandle,
    args: &ExecuteAthenaSqlArgs,
) -> AppResult<ExecuteAthenaSqlResult> {
    match gate::classify(&args.sql) {
        StatementClass::Blocked { reason } => {
            return Ok(ExecuteAthenaSqlResult::refused(&args.sql, &reason));
        }
        StatementClass::Read => {}
    }

    let max_rows = args.max_rows.unwrap_or(50).clamp(1, TOOL_MAX_ROWS);
    let started = athena::start_athena_query(
        app.clone(),
        StartAthenaQueryRequest {
            account_id: None,
            sql: args.sql.clone(),
            database: args.database.clone(),
            workgroup: args.workgroup.clone(),
            output_location: args.output_location.clone(),
            catalog: None,
        },
    )
    .await?;

    let query_execution_id = started.query_execution_id.clone();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(POLL_TIMEOUT_SECS);
    let mut execution = started;

    while matches!(
        execution.state.as_str(),
        "QUEUED" | "RUNNING" | "UNKNOWN"
    ) {
        if std::time::Instant::now() >= deadline {
            return Ok(ExecuteAthenaSqlResult {
                query_execution_id: execution.query_execution_id,
                state: execution.state,
                columns: None,
                rows: None,
                returned_rows: 0,
                truncated: false,
                next_token: None,
                note: Some("Timed out waiting for Athena. Check the query in the Glue Catalog tab.".into()),
                error: Some("Athena query did not finish in time.".into()),
            });
        }
        tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)).await;
        execution = athena::get_athena_query_execution(
            app.clone(),
            AthenaQueryExecutionRequest {
                account_id: None,
                query_execution_id: query_execution_id.clone(),
            },
        )
        .await?;
    }

    if execution.state != "SUCCEEDED" {
        return Ok(ExecuteAthenaSqlResult {
            query_execution_id: execution.query_execution_id,
            state: execution.state.clone(),
            columns: None,
            rows: None,
            returned_rows: 0,
            truncated: false,
            next_token: None,
            note: None,
            error: Some(
                execution
                    .state_change_reason
                    .unwrap_or_else(|| format!("Athena finished in state {}.", execution.state)),
            ),
        });
    }

    let page = athena::get_athena_query_results(
        app.clone(),
        AthenaQueryResultsRequest {
            account_id: None,
            query_execution_id: query_execution_id.clone(),
            next_token: None,
            max_results: Some(max_rows),
        },
    )
    .await?;

    let returned_rows = page.rows.len();
    let truncated = page.next_token.is_some() || returned_rows as i32 >= max_rows;
    Ok(ExecuteAthenaSqlResult {
        query_execution_id,
        state: execution.state,
        columns: Some(page.column_names),
        rows: Some(page.rows),
        returned_rows,
        truncated,
        next_token: page.next_token,
        note: if truncated {
            Some(format!(
                "Result page capped at {max_rows} rows. Narrow the query for more."
            ))
        } else {
            None
        },
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refused_result_carries_error() {
        let refused = ExecuteAthenaSqlResult::refused("DROP TABLE t", "blocked");
        assert_eq!(refused.error.as_deref(), Some("blocked"));
        assert_eq!(refused.state, "REFUSED");
    }

    #[test]
    fn gate_blocks_athena_ddl_before_start() {
        match gate::classify("DROP TABLE foo") {
            StatementClass::Blocked { .. } => {}
            StatementClass::Read => panic!("DDL must be blocked"),
        }
        match gate::classify("SELECT 1") {
            StatementClass::Read => {}
            StatementClass::Blocked { reason } => panic!("SELECT should pass: {reason}"),
        }
    }
}
