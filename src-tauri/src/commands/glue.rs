use crate::aws::runtime::runtime_for_context;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, GlueColumn, GlueDatabase, GlueGetTableRequest, GlueListDatabasesResponse,
    GlueListRequest, GlueListTablesResponse, GlueTableDetail, GlueTableSummary, GlueUpdateTableRequest,
};
use aws_sdk_glue::types::{Column, SerDeInfo, StorageDescriptor, TableInput};
use std::collections::HashMap;
use tauri::AppHandle;

fn optional_catalog_id(value: Option<String>) -> Option<String> {
    value.filter(|entry| !entry.trim().is_empty())
}

#[tauri::command]
pub async fn list_glue_databases(
    app: AppHandle,
    request: GlueListRequest,
) -> AppResult<GlueListDatabasesResponse> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = aws_sdk_glue::Client::new(&runtime.config);
    let catalog = optional_catalog_id(request.catalog_id);
    let mut operation = client
        .get_databases()
        .max_results(request.max_results.unwrap_or(100).clamp(1, 1000));
    if let Some(catalog) = catalog.as_deref() {
        operation = operation.catalog_id(catalog);
    }
    if let Some(token) = request.next_token {
        operation = operation.next_token(token);
    }

    let response = operation.send().await.map_err(|error| {
        AppError::aws_for_account_sdk("glue", runtime.account.id.clone(), error)
    })?;

    Ok(GlueListDatabasesResponse {
        databases: response
            .database_list()
            .iter()
            .map(|database| GlueDatabase {
                name: database.name().to_string(),
                description: database.description().map(str::to_string),
                location_uri: database.location_uri().map(str::to_string),
            })
            .collect(),
        next_token: response.next_token().map(str::to_string),
    })
}

#[tauri::command]
pub async fn list_glue_tables(
    app: AppHandle,
    request: GlueListRequest,
) -> AppResult<GlueListTablesResponse> {
    let database_name = request
        .database_name
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::validation("databaseName is required."))?;
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = aws_sdk_glue::Client::new(&runtime.config);
    let catalog = optional_catalog_id(request.catalog_id);
    let mut operation = client
        .get_tables()
        .database_name(&database_name)
        .max_results(request.max_results.unwrap_or(100).clamp(1, 1000));
    if let Some(catalog) = catalog.as_deref() {
        operation = operation.catalog_id(catalog);
    }
    if let Some(token) = request.next_token {
        operation = operation.next_token(token);
    }

    let response = operation.send().await.map_err(|error| {
        AppError::aws_for_account_sdk("glue", runtime.account.id.clone(), error)
    })?;

    Ok(GlueListTablesResponse {
        tables: response
            .table_list()
            .iter()
            .map(|table| GlueTableSummary {
                name: table.name().to_string(),
                database_name: table.database_name().unwrap_or_default().to_string(),
                table_type: table.table_type().map(str::to_string),
                create_time: table.create_time().map(|value| value.to_string()),
            })
            .collect(),
        next_token: response.next_token().map(str::to_string),
    })
}

#[tauri::command]
pub async fn get_glue_table(
    app: AppHandle,
    request: GlueGetTableRequest,
) -> AppResult<GlueTableDetail> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = aws_sdk_glue::Client::new(&runtime.config);
    let catalog = optional_catalog_id(request.catalog_id);
    let mut operation = client
        .get_table()
        .database_name(&request.database_name)
        .name(&request.table_name);
    if let Some(catalog) = catalog.as_deref() {
        operation = operation.catalog_id(catalog);
    }
    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("glue", runtime.account.id, error))?;

    response
        .table()
        .map(table_detail_from_glue)
        .ok_or_else(|| AppError::validation("Glue table was not found."))
}

#[tauri::command]
pub async fn update_glue_table(
    app: AppHandle,
    request: GlueUpdateTableRequest,
) -> AppResult<GlueTableDetail> {
    let account_id = request.account_id.clone();
    let database_name = request.table.database_name.clone();
    let table_name = request.table.name.clone();
    let catalog_id = optional_catalog_id(request.catalog_id.clone());
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = aws_sdk_glue::Client::new(&runtime.config);
    let table_input = table_input_from_detail(&request.table)?;

    let mut operation = client
        .update_table()
        .database_name(&database_name)
        .table_input(table_input);
    if let Some(catalog) = catalog_id.as_deref() {
        operation = operation.catalog_id(catalog);
    }
    operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("glue", runtime.account.id, error))?;

    get_glue_table(
        app,
        GlueGetTableRequest {
            account_id,
            catalog_id,
            database_name,
            table_name,
        },
    )
    .await
}

fn hash_map_from_option(value: Option<&HashMap<String, String>>) -> HashMap<String, String> {
    value
        .map(|entries| {
            entries
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default()
}

fn table_detail_from_glue(table: &aws_sdk_glue::types::Table) -> GlueTableDetail {
    let storage = table.storage_descriptor();
    let serde = storage.and_then(|descriptor| descriptor.serde_info());

    GlueTableDetail {
        name: table.name().to_string(),
        database_name: table.database_name().unwrap_or_default().to_string(),
        catalog_id: table.catalog_id().unwrap_or_default().to_string(),
        description: table.description().map(str::to_string),
        table_type: table.table_type().map(str::to_string),
        owner: table.owner().map(str::to_string),
        create_time: table.create_time().map(|value| value.to_string()),
        update_time: table.update_time().map(|value| value.to_string()),
        parameters: hash_map_from_option(table.parameters()),
        columns: storage
            .map(|descriptor| {
                descriptor
                    .columns()
                    .iter()
                    .map(column_from_glue)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        partition_keys: table
            .partition_keys()
            .iter()
            .map(column_from_glue)
            .collect(),
        location: storage.and_then(|descriptor| descriptor.location()).map(str::to_string),
        input_format: storage
            .and_then(|descriptor| descriptor.input_format())
            .map(str::to_string),
        output_format: storage
            .and_then(|descriptor| descriptor.output_format())
            .map(str::to_string),
        serde_library: serde.and_then(|info| info.serialization_library()).map(str::to_string),
        serde_parameters: serde
            .map(|info| hash_map_from_option(info.parameters()))
            .unwrap_or_default(),
    }
}

fn column_from_glue(column: &Column) -> GlueColumn {
    GlueColumn {
        name: column.name().to_string(),
        r#type: column.r#type().unwrap_or_default().to_string(),
        comment: column.comment().map(str::to_string),
    }
}

fn build_column(column: &GlueColumn) -> AppResult<Column> {
    Column::builder()
        .name(&column.name)
        .r#type(&column.r#type)
        .set_comment(column.comment.clone())
        .build()
        .map_err(|error| AppError::validation(format!("Invalid Glue column: {error}")))
}

fn table_input_from_detail(detail: &GlueTableDetail) -> AppResult<TableInput> {
    let columns = detail
        .columns
        .iter()
        .map(build_column)
        .collect::<AppResult<Vec<_>>>()?;
    let partition_keys = detail
        .partition_keys
        .iter()
        .map(build_column)
        .collect::<AppResult<Vec<_>>>()?;
    let serde = if detail.serde_library.is_some() || !detail.serde_parameters.is_empty() {
        Some(
            SerDeInfo::builder()
                .set_serialization_library(detail.serde_library.clone())
                .set_parameters(Some(detail.serde_parameters.clone()))
                .build(),
        )
    } else {
        None
    };
    let storage = StorageDescriptor::builder()
        .set_columns(Some(columns))
        .set_location(detail.location.clone())
        .set_input_format(detail.input_format.clone())
        .set_output_format(detail.output_format.clone())
        .set_serde_info(serde)
        .build();

    TableInput::builder()
        .name(&detail.name)
        .set_description(detail.description.clone())
        .set_owner(detail.owner.clone())
        .set_table_type(detail.table_type.clone())
        .set_parameters(Some(detail.parameters.clone()))
        .set_partition_keys(Some(partition_keys))
        .storage_descriptor(storage)
        .build()
        .map_err(|error| AppError::validation(format!("Invalid Glue table input: {error}")))
}

#[cfg(test)]
mod tests {
    use super::optional_catalog_id;

    #[test]
    fn omits_default_glue_catalog_id() {
        assert_eq!(optional_catalog_id(None), None);
        assert_eq!(optional_catalog_id(Some("".to_string())), None);
        assert_eq!(optional_catalog_id(Some("  ".to_string())), None);
    }

    #[test]
    fn keeps_explicit_catalog_id() {
        assert_eq!(
            optional_catalog_id(Some("123456789012".to_string())),
            Some("123456789012".to_string())
        );
    }
}
