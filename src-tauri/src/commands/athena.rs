use crate::aws::runtime::runtime_for_context;
use crate::commands::files::save_text_file;
use crate::error::{AppError, AppResult};
use crate::models::{
    AthenaQueryExecution, AthenaQueryExecutionRequest, AthenaQueryResults, AthenaQueryResultsRequest,
    AthenaWorkgroup, AwsCommandContext, ExportAthenaQueryCsvRequest, SaveTextFileRequest,
    StartAthenaQueryRequest,
};
use aws_sdk_athena::types::{QueryExecutionContext, QueryExecutionState, ResultConfiguration};
use tauri::AppHandle;

const DEFAULT_CATALOG: &str = "AwsDataCatalog";

#[tauri::command]
pub async fn list_athena_workgroups(
    app: AppHandle,
    request: AwsCommandContext,
) -> AppResult<Vec<AthenaWorkgroup>> {
    let runtime = runtime_for_context(&app, request).await?;
    let client = aws_sdk_athena::Client::new(&runtime.config);
    let mut workgroups = Vec::new();
    let mut next_token: Option<String> = None;

    loop {
        let mut operation = client.list_work_groups().max_results(50);
        if let Some(token) = next_token.clone() {
            operation = operation.next_token(token);
        }
        let response = operation.send().await.map_err(|error| {
            AppError::aws_for_account_sdk("athena", runtime.account.id.clone(), error)
        })?;
        workgroups.extend(
            response
                .work_groups()
                .iter()
                .filter_map(|entry| entry.name())
                .map(|name| AthenaWorkgroup {
                    name: name.to_string(),
                    description: None,
                    state: None,
                }),
        );
        next_token = response.next_token().map(str::to_string);
        if next_token.is_none() {
            break;
        }
    }

    Ok(workgroups)
}

#[tauri::command]
pub async fn start_athena_query(
    app: AppHandle,
    request: StartAthenaQueryRequest,
) -> AppResult<AthenaQueryExecution> {
    if request.sql.trim().is_empty() {
        return Err(AppError::validation("SQL is required."));
    }
    if request.workgroup.trim().is_empty() {
        return Err(AppError::validation("Workgroup is required."));
    }
    if request.output_location.trim().is_empty() {
        return Err(AppError::validation("Athena output location is required."));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = aws_sdk_athena::Client::new(&runtime.config);
    let catalog = request
        .catalog
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CATALOG.to_string());
    let mut context = QueryExecutionContext::builder().catalog(catalog);
    if let Some(database) = request.database.filter(|value| !value.trim().is_empty()) {
        context = context.database(database);
    }
    let result_configuration = ResultConfiguration::builder()
        .output_location(request.output_location.trim())
        .build();
    let response = client
        .start_query_execution()
        .query_string(request.sql.trim())
        .work_group(request.workgroup.trim())
        .query_execution_context(context.build())
        .result_configuration(result_configuration)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("athena", runtime.account.id, error))?;

    let query_execution_id = response
        .query_execution_id()
        .ok_or_else(|| AppError::validation("Athena did not return a query execution id."))?
        .to_string();

    get_athena_query_execution(
        app,
        AthenaQueryExecutionRequest {
            account_id: None,
            query_execution_id,
        },
    )
    .await
}

#[tauri::command]
pub async fn get_athena_query_execution(
    app: AppHandle,
    request: AthenaQueryExecutionRequest,
) -> AppResult<AthenaQueryExecution> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = aws_sdk_athena::Client::new(&runtime.config);
    let response = client
        .get_query_execution()
        .query_execution_id(&request.query_execution_id)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("athena", runtime.account.id, error))?;

    let execution = response
        .query_execution()
        .ok_or_else(|| AppError::validation("Athena query execution was not found."))?;
    let status = execution.status();
    let statistics = execution.statistics();
    let state = status
        .and_then(|value| value.state())
        .map(|value| query_state_as_str(&value))
        .unwrap_or("UNKNOWN");

    Ok(AthenaQueryExecution {
        query_execution_id: execution
            .query_execution_id()
            .unwrap_or(&request.query_execution_id)
            .to_string(),
        state: state.to_string(),
        state_change_reason: status
            .and_then(|value| value.state_change_reason())
            .map(str::to_string),
        submission_date_time: status
            .and_then(|value| value.submission_date_time())
            .map(|value| value.to_string()),
        completion_date_time: status
            .and_then(|value| value.completion_date_time())
            .map(|value| value.to_string()),
        data_scanned_bytes: statistics.and_then(|value| value.data_scanned_in_bytes()),
        engine_execution_time_ms: statistics.and_then(|value| value.engine_execution_time_in_millis()),
    })
}

#[tauri::command]
pub async fn get_athena_query_results(
    app: AppHandle,
    request: AthenaQueryResultsRequest,
) -> AppResult<AthenaQueryResults> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = aws_sdk_athena::Client::new(&runtime.config);
    let mut operation = client
        .get_query_results()
        .query_execution_id(&request.query_execution_id)
        .max_results(request.max_results.unwrap_or(1000).clamp(1, 1000));
    if let Some(token) = request.next_token {
        operation = operation.next_token(token);
    }

    let response = operation.send().await.map_err(|error| {
        AppError::aws_for_account_sdk("athena", runtime.account.id, error)
    })?;
    let result_set = response
        .result_set()
        .ok_or_else(|| AppError::validation("Athena query results were not found."))?;
    let column_names = result_set
        .result_set_metadata()
        .map(|metadata| {
            metadata
                .column_info()
                .iter()
                .map(|column| column.name().to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rows = result_set
        .rows()
        .iter()
        .map(|row| {
            row.data()
                .iter()
                .map(|datum| datum.var_char_value().unwrap_or_default().to_string())
                .collect::<Vec<_>>()
        })
        .collect();

    Ok(AthenaQueryResults {
        column_names,
        rows,
        next_token: response.next_token().map(str::to_string),
    })
}

#[tauri::command]
pub async fn stop_athena_query(
    app: AppHandle,
    request: AthenaQueryExecutionRequest,
) -> AppResult<AthenaQueryExecution> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_athena::Client::new(&runtime.config);
    client
        .stop_query_execution()
        .query_execution_id(&request.query_execution_id)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("athena", runtime.account.id, error))?;

    get_athena_query_execution(app, request).await
}

#[tauri::command]
pub async fn export_athena_query_csv(
    app: AppHandle,
    request: ExportAthenaQueryCsvRequest,
) -> AppResult<Option<String>> {
    let mut next_token: Option<String> = None;
    let mut column_names: Vec<String> = Vec::new();
    let mut data_rows: Vec<Vec<String>> = Vec::new();
    let mut header_skipped = false;

    loop {
        let page = get_athena_query_results(
            app.clone(),
            AthenaQueryResultsRequest {
                account_id: request.account_id.clone(),
                query_execution_id: request.query_execution_id.clone(),
                next_token: next_token.clone(),
                max_results: Some(1000),
            },
        )
        .await?;

        if column_names.is_empty() {
            column_names = page.column_names;
        }

        for (index, row) in page.rows.into_iter().enumerate() {
            if !header_skipped && index == 0 && is_header_row(&row, &column_names) {
                header_skipped = true;
                continue;
            }
            data_rows.push(row);
        }

        if !header_skipped && !column_names.is_empty() {
            header_skipped = true;
        }

        next_token = page.next_token;
        if next_token.is_none() {
            break;
        }
    }

    let csv = rows_to_csv(&column_names, &data_rows);
    save_text_file(SaveTextFileRequest {
        suggested_name: request.suggested_name,
        content: csv,
    })
    .await
}

fn query_state_as_str(state: &QueryExecutionState) -> &'static str {
    match state {
        QueryExecutionState::Queued => "QUEUED",
        QueryExecutionState::Running => "RUNNING",
        QueryExecutionState::Succeeded => "SUCCEEDED",
        QueryExecutionState::Failed => "FAILED",
        QueryExecutionState::Cancelled => "CANCELLED",
        _ => "UNKNOWN",
    }
}

fn is_header_row(row: &[String], column_names: &[String]) -> bool {
    row.len() == column_names.len() && row.iter().zip(column_names.iter()).all(|(left, right)| left == right)
}

fn rows_to_csv(column_names: &[String], rows: &[Vec<String>]) -> String {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(column_names.iter().map(|value| escape_csv(value)).collect::<Vec<_>>().join(","));
    for row in rows {
        lines.push(row.iter().map(|value| escape_csv(value)).collect::<Vec<_>>().join(","));
    }
    lines.join("\n")
}

fn escape_csv(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{escape_csv, is_header_row, rows_to_csv};

    #[test]
    fn escapes_csv_values_with_commas() {
        assert_eq!(escape_csv("a,b"), "\"a,b\"");
    }

    #[test]
    fn builds_csv_with_header() {
        let csv = rows_to_csv(&["id".to_string(), "name".to_string()], &[vec!["1".to_string(), "alpha".to_string()]]);
        assert_eq!(csv, "id,name\n1,alpha");
    }

    #[test]
    fn detects_header_row() {
        assert!(is_header_row(
            &["id".to_string(), "name".to_string()],
            &["id".to_string(), "name".to_string()]
        ));
    }
}
