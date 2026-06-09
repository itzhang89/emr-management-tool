use crate::aws::credentials::{aws_config_from_credentials, clear_credentials as clear_saved_credentials, save_credentials};
use crate::error::{AppError, AppResult};
use crate::models::{AwsCredentialsInput, AwsIdentity, AwsSettings};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn test_aws_credentials(request: AwsCredentialsInput) -> AppResult<AwsIdentity> {
    let config = aws_config_from_credentials(&request).await;
    let client = aws_sdk_sts::Client::new(&config);
    let identity = client
        .get_caller_identity()
        .send()
        .await
        .map_err(|error| AppError::aws("sts", error))?;

    Ok(AwsIdentity {
        account: identity.account().unwrap_or_default().to_string(),
        arn: identity.arn().unwrap_or_default().to_string(),
        user_id: identity.user_id().unwrap_or_default().to_string(),
    })
}

#[tauri::command]
pub async fn save_aws_credentials(state: State<'_, AppState>, request: AwsCredentialsInput) -> AppResult<AwsSettings> {
    let identity = test_aws_credentials(request.clone()).await?;
    save_credentials(&request)?;

    let settings = AwsSettings {
        region: request.region,
        has_saved_credentials: true,
        identity: Some(identity),
    };
    *state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("Settings lock was poisoned.".to_string()))? = settings.clone();

    Ok(settings)
}

#[tauri::command]
pub async fn get_aws_settings(state: State<'_, AppState>) -> AppResult<AwsSettings> {
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|_| AppError::Internal("Settings lock was poisoned.".to_string()))
}

#[tauri::command]
pub async fn clear_aws_credentials(state: State<'_, AppState>) -> AppResult<AwsSettings> {
    clear_saved_credentials()?;
    let settings = AwsSettings {
        region: "us-east-1".to_string(),
        has_saved_credentials: false,
        identity: None,
    };
    *state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("Settings lock was poisoned.".to_string()))? = settings.clone();

    Ok(settings)
}
