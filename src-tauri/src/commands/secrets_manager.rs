//! AWS Secrets Manager commands (active-account scoped).
//!
//! List/describe never return SecretString. Create stamps local `submitUser` +
//! `managedBy` tags. Reveal/copy return the value once for an explicit UI action;
//! the WebView writes the clipboard (same pattern as the rest of the app).

use crate::aws::runtime::runtime_for_context;
use crate::aws::secrets_manager::{self, list_all_secrets, merge_create_tags};
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, CreateSecretInput, SecretIdRequest, SecretSummary, SecretTag,
    SecretValueResponse,
};
use tauri::AppHandle;

fn sm_client(runtime: &crate::aws::runtime::AwsRuntime) -> aws_sdk_secretsmanager::Client {
    aws_sdk_secretsmanager::Client::new(&runtime.config)
}

fn map_sm_error(
    account_id: &str,
    error: impl aws_smithy_types::error::metadata::ProvideErrorMetadata + std::fmt::Display,
) -> AppError {
    AppError::aws_for_account_sdk("secretsmanager", account_id, error)
}

#[tauri::command]
pub async fn list_secrets(app: AppHandle) -> AppResult<Vec<SecretSummary>> {
    let runtime = runtime_for_context(&app, AwsCommandContext { account_id: None }).await?;
    let client = sm_client(&runtime);
    list_all_secrets(&client).await.map_err(|error| {
        AppError::aws_for_account(
            "secretsmanager",
            runtime.account.id.clone(),
            error.to_string(),
        )
    })
}

#[tauri::command]
pub async fn describe_secret(
    app: AppHandle,
    request: SecretIdRequest,
) -> AppResult<SecretSummary> {
    let secret_id = request.secret_id.trim();
    if secret_id.is_empty() {
        return Err(AppError::validation("secretId is required."));
    }
    let runtime = runtime_for_context(&app, AwsCommandContext { account_id: None }).await?;
    let client = sm_client(&runtime);
    let response = client
        .describe_secret()
        .secret_id(secret_id)
        .send()
        .await
        .map_err(|error| map_sm_error(&runtime.account.id, error))?;

    let name = response
        .name()
        .map(str::to_string)
        .ok_or_else(|| AppError::validation("Secret has no name."))?;
    let arn = response
        .arn()
        .map(str::to_string)
        .ok_or_else(|| AppError::validation("Secret has no ARN."))?;
    Ok(SecretSummary {
        name,
        arn,
        description: response.description().map(str::to_string),
        tags: response
            .tags()
            .iter()
            .filter_map(|tag| {
                Some(SecretTag {
                    key: tag.key()?.to_string(),
                    value: tag.value().unwrap_or("").to_string(),
                })
            })
            .collect(),
        last_changed_date: response.last_changed_date().and_then(|value| {
            chrono::DateTime::<chrono::Utc>::from_timestamp(value.secs(), value.subsec_nanos())
                .map(|dt| dt.to_rfc3339())
        }),
    })
}

#[tauri::command]
pub async fn create_secret(
    app: AppHandle,
    request: CreateSecretInput,
) -> AppResult<SecretSummary> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Secret name is required."));
    }
    if request.secret_string.trim().is_empty() {
        return Err(AppError::validation("Secret value is required."));
    }
    // Validate JSON early so we do not create an unusable DBHub secret.
    let _ = secrets_manager::parse_db_secret_json(&request.secret_string)?;

    let submit_user = crate::commands::system::get_submit_user()?;
    let tags = merge_create_tags(&submit_user, &request.tags)?;

    let runtime = runtime_for_context(&app, AwsCommandContext { account_id: None }).await?;
    let client = sm_client(&runtime);

    let mut operation = client
        .create_secret()
        .name(name)
        .secret_string(&request.secret_string)
        .set_tags(Some(tags));
    if let Some(description) = request
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        operation = operation.description(description);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| map_sm_error(&runtime.account.id, error))?;

    let arn = response
        .arn()
        .map(str::to_string)
        .unwrap_or_else(|| name.to_string());
    describe_secret(app, SecretIdRequest { secret_id: arn }).await
}

#[tauri::command]
pub async fn get_secret_value(
    app: AppHandle,
    request: SecretIdRequest,
) -> AppResult<SecretValueResponse> {
    let secret_id = request.secret_id.trim();
    if secret_id.is_empty() {
        return Err(AppError::validation("secretId is required."));
    }
    let runtime = runtime_for_context(&app, AwsCommandContext { account_id: None }).await?;
    let client = sm_client(&runtime);
    let response = client
        .get_secret_value()
        .secret_id(secret_id)
        .send()
        .await
        .map_err(|error| map_sm_error(&runtime.account.id, error))?;
    let value = response.secret_string().map(str::to_string).ok_or_else(|| {
        AppError::validation("Secret has no SecretString (binary secrets are not supported).")
    })?;
    Ok(SecretValueResponse { value })
}
