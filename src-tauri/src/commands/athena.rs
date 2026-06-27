use crate::aws::runtime::runtime_for_context;
use crate::commands::files::save_text_file;
use crate::error::{AppError, AppResult};
use crate::models::{
    AthenaQueryExecution, AthenaQueryExecutionRequest, AthenaQueryResults,
    AthenaQueryResultsRequest, AthenaWorkgroup, AwsCommandContext, ExportAthenaQueryCsvRequest,
    SaveTextFileRequest, StartAthenaQueryRequest,
};
use aws_sdk_athena::types::{QueryExecutionContext, QueryExecutionState, ResultConfiguration};
use tauri::AppHandle;

const DEFAULT_CATALOG: &str = "AwsDataCatalog";

struct WorkgroupExecutionSettings {
    managed_results_enabled: bool,
    enforce_configuration: bool,
    workgroup_output_location: Option<String>,
    spark_enabled: bool,
    effective_engine_version: Option<String>,
}

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
        for entry in response.work_groups() {
            if let Some(name) = entry.name() {
                let details = load_workgroup_execution_settings(&client, name)
                    .await
                    .ok()
                    .flatten();
                workgroups.push(AthenaWorkgroup {
                    name: name.to_string(),
                    description: entry.description().map(str::to_string),
                    state: entry.state().map(|state| state.as_str().to_string()),
                    managed_results_enabled: details
                        .as_ref()
                        .map(|settings| settings.managed_results_enabled)
                        .unwrap_or(false),
                    enforce_configuration: details
                        .as_ref()
                        .map(|settings| settings.enforce_configuration)
                        .unwrap_or(false),
                    output_location: details
                        .as_ref()
                        .and_then(|settings| settings.workgroup_output_location.clone()),
                    spark_enabled: details
                        .as_ref()
                        .map(|settings| settings.spark_enabled)
                        .unwrap_or(false),
                    effective_engine_version: details
                        .as_ref()
                        .and_then(|settings| settings.effective_engine_version.clone()),
                });
            }
        }
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

    let sql = normalize_athena_sql(&request.sql, request.database.as_deref());
    if sql.is_empty() {
        return Err(AppError::validation("SQL is required."));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = aws_sdk_athena::Client::new(&runtime.config);
    let workgroup_name = request.workgroup.trim();
    let settings = load_workgroup_execution_settings(&client, workgroup_name)
        .await?
        .unwrap_or(WorkgroupExecutionSettings {
            managed_results_enabled: false,
            enforce_configuration: false,
            workgroup_output_location: None,
            spark_enabled: false,
            effective_engine_version: None,
        });

    if settings.spark_enabled {
        return Err(AppError::validation(
            "The selected Athena workgroup is Spark-enabled and cannot run SQL queries from the query editor. Choose an Athena SQL workgroup.",
        ));
    }

    let result_configuration = resolve_result_configuration(
        &settings,
        request.output_location.as_deref().unwrap_or("").trim(),
    )?;

    ensure_query_can_run(&settings, &result_configuration)?;

    let catalog = request
        .catalog
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CATALOG.to_string());
    let mut context = QueryExecutionContext::builder().catalog(catalog);
    if let Some(database) = request.database.filter(|value| !value.trim().is_empty()) {
        context = context.database(database);
    }
    let query_context = context.build();

    let account_id = runtime.account.id.clone();
    let mut operation = client
        .start_query_execution()
        .query_string(&sql)
        .work_group(workgroup_name)
        .query_execution_context(query_context);

    if let Some(configuration) = result_configuration {
        operation = operation.result_configuration(configuration);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("athena", account_id.clone(), error))?;

    let query_execution_id = response
        .query_execution_id()
        .ok_or_else(|| AppError::validation("Athena did not return a query execution id."))?
        .to_string();

    get_athena_query_execution(
        app,
        AthenaQueryExecutionRequest {
            account_id: Some(account_id),
            query_execution_id,
        },
    )
    .await
}

async fn load_workgroup_execution_settings(
    client: &aws_sdk_athena::Client,
    workgroup_name: &str,
) -> AppResult<Option<WorkgroupExecutionSettings>> {
    let response = client
        .get_work_group()
        .work_group(workgroup_name)
        .send()
        .await
        .map_err(|error| AppError::aws_sdk("athena", error))?;

    let configuration = response
        .work_group()
        .and_then(|workgroup| workgroup.configuration());

    Ok(configuration.map(|config| {
        let managed_results_enabled = config
            .managed_query_results_configuration()
            .map(|managed| managed.enabled())
            .unwrap_or(false);
        let enforce_configuration = config.enforce_work_group_configuration().unwrap_or(false);
        let workgroup_output_location = config
            .result_configuration()
            .and_then(|result| result.output_location())
            .filter(|location| !location.is_empty())
            .map(str::to_string);
        let effective_engine_version = config
            .engine_version()
            .and_then(|version| version.effective_engine_version())
            .filter(|version| !version.is_empty())
            .map(str::to_string);
        let spark_enabled = effective_engine_version
            .as_deref()
            .map(is_spark_engine_version)
            .unwrap_or(false);

        WorkgroupExecutionSettings {
            managed_results_enabled,
            enforce_configuration,
            workgroup_output_location,
            spark_enabled,
            effective_engine_version,
        }
    }))
}

fn normalize_athena_sql(sql: &str, database: Option<&str>) -> String {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let without_trailing_semicolons = trimmed.trim_end_matches(';').trim();
    let mut normalized = without_trailing_semicolons.replace('`', "\"");

    if let Some(database) = database.filter(|value| !value.is_empty()) {
        let quoted_prefix = format!("\"{database}\".");
        normalized = normalized.replace(&quoted_prefix, "");
        let plain_prefix = format!("{database}.");
        normalized = normalized.replace(&plain_prefix, "");
    }

    normalized
}

fn is_spark_engine_version(version: &str) -> bool {
    let lower = version.to_ascii_lowercase();
    lower.contains("spark") || lower.contains("pyspark")
}

fn ensure_query_can_run(
    settings: &WorkgroupExecutionSettings,
    result_configuration: &Option<ResultConfiguration>,
) -> AppResult<()> {
    if settings.managed_results_enabled {
        return Ok(());
    }

    if result_configuration.is_some() {
        return Ok(());
    }

    if settings.workgroup_output_location.is_some() {
        return Ok(());
    }

    Err(AppError::validation(
        "Athena output location is required. Set a results S3 path in the query bar or Settings, or enable Athena managed query results on the workgroup.",
    ))
}

fn resolve_result_configuration(
    settings: &WorkgroupExecutionSettings,
    client_output_location: &str,
) -> AppResult<Option<ResultConfiguration>> {
    let client_path = client_output_location.trim();

    // Managed results: Athena stores output itself — never send ResultConfiguration.
    if settings.managed_results_enabled {
        return Ok(None);
    }

    // Workgroup enforces its own result settings — client cannot override.
    if settings.enforce_configuration {
        if settings.workgroup_output_location.is_some() {
            return Ok(None);
        }
        if !client_path.is_empty() {
            return Ok(Some(
                ResultConfiguration::builder()
                    .output_location(client_path)
                    .build(),
            ));
        }
        return Err(AppError::validation(
            "The selected Athena workgroup enforces result settings but has no output location configured in AWS.",
        ));
    }

    // Client S3 path (default UX).
    if !client_path.is_empty() {
        return Ok(Some(
            ResultConfiguration::builder()
                .output_location(client_path)
                .build(),
        ));
    }

    // Fall back to workgroup default output location.
    if settings.workgroup_output_location.is_some() {
        return Ok(None);
    }

    Err(AppError::validation(
        "Athena output location is required. Set a results S3 path in the query bar or Settings.",
    ))
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
        engine_execution_time_ms: statistics
            .and_then(|value| value.engine_execution_time_in_millis()),
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

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("athena", runtime.account.id, error))?;
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
    row.len() == column_names.len()
        && row
            .iter()
            .zip(column_names.iter())
            .all(|(left, right)| left == right)
}

fn rows_to_csv(column_names: &[String], rows: &[Vec<String>]) -> String {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(
        column_names
            .iter()
            .map(|value| escape_csv(value))
            .collect::<Vec<_>>()
            .join(","),
    );
    for row in rows {
        lines.push(
            row.iter()
                .map(|value| escape_csv(value))
                .collect::<Vec<_>>()
                .join(","),
        );
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
    use super::{
        ensure_query_can_run, escape_csv, is_header_row, is_spark_engine_version,
        normalize_athena_sql, resolve_result_configuration, rows_to_csv,
        WorkgroupExecutionSettings,
    };

    #[test]
    fn escapes_csv_values_with_commas() {
        assert_eq!(escape_csv("a,b"), "\"a,b\"");
    }

    #[test]
    fn builds_csv_with_header() {
        let csv = rows_to_csv(
            &["id".to_string(), "name".to_string()],
            &[vec!["1".to_string(), "alpha".to_string()]],
        );
        assert_eq!(csv, "id,name\n1,alpha");
    }

    #[test]
    fn detects_header_row() {
        assert!(is_header_row(
            &["id".to_string(), "name".to_string()],
            &["id".to_string(), "name".to_string()]
        ));
    }

    #[test]
    fn skips_result_configuration_for_managed_results() {
        let settings = WorkgroupExecutionSettings {
            managed_results_enabled: true,
            enforce_configuration: false,
            workgroup_output_location: None,
            spark_enabled: false,
            effective_engine_version: None,
        };
        assert!(resolve_result_configuration(&settings, "s3://bucket/path/")
            .unwrap()
            .is_none());
    }

    #[test]
    fn uses_client_output_when_not_managed() {
        let settings = WorkgroupExecutionSettings {
            managed_results_enabled: false,
            enforce_configuration: false,
            workgroup_output_location: None,
            spark_enabled: false,
            effective_engine_version: None,
        };
        let configuration = resolve_result_configuration(&settings, "s3://bucket/path/").unwrap();
        assert!(configuration.is_some());
    }

    #[test]
    fn strips_trailing_semicolons_from_sql() {
        assert_eq!(normalize_athena_sql("SELECT 1;", None), "SELECT 1");
        assert_eq!(
            normalize_athena_sql("SELECT * FROM t LIMIT 100;", None),
            "SELECT * FROM t LIMIT 100"
        );
    }

    #[test]
    fn converts_backticks_to_double_quotes() {
        assert_eq!(
            normalize_athena_sql(
                "SELECT * FROM `shiji`.`ods__table` LIMIT 100",
                Some("shiji")
            ),
            r#"SELECT * FROM "ods__table" LIMIT 100"#
        );
    }

    #[test]
    fn detects_spark_engine_versions() {
        assert!(is_spark_engine_version("PySpark engine version 3"));
        assert!(!is_spark_engine_version("Athena engine version 3"));
    }

    #[test]
    fn allows_managed_workgroup_without_result_configuration() {
        let settings = WorkgroupExecutionSettings {
            managed_results_enabled: true,
            enforce_configuration: false,
            workgroup_output_location: None,
            spark_enabled: false,
            effective_engine_version: None,
        };
        assert!(ensure_query_can_run(&settings, &None).is_ok());
    }

    #[test]
    fn rejects_non_managed_workgroup_without_any_output_location() {
        let settings = WorkgroupExecutionSettings {
            managed_results_enabled: false,
            enforce_configuration: false,
            workgroup_output_location: None,
            spark_enabled: false,
            effective_engine_version: None,
        };
        assert!(ensure_query_can_run(&settings, &None).is_err());
    }
}
