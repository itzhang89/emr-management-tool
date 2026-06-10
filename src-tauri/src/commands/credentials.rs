use crate::aws::credentials::{
    aws_config_from_credentials, clear_account_credentials, clear_credentials as clear_saved_credentials,
    save_account_credentials, save_credentials,
};
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsAccount, AwsAccountCredentialsInput, AwsAccountSummary, AwsCredentialsInput, AwsIdentity, AwsSettings,
};
use crate::state::AppState;
use chrono::Utc;
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
pub async fn list_aws_accounts() -> AppResult<Vec<AwsAccountSummary>> {
    let pool = repository::pool().await?;
    Ok(repository::list_aws_accounts(&pool)
        .await?
        .into_iter()
        .map(AwsAccountSummary::from)
        .collect())
}

#[tauri::command]
pub async fn create_aws_account(request: AwsAccountCredentialsInput) -> AppResult<AwsAccount> {
    if request.name.trim().is_empty() {
        return Err(AppError::validation("Account name is required."));
    }
    if request.region.trim().is_empty() {
        return Err(AppError::validation("Region is required."));
    }

    let identity = test_aws_credentials(AwsCredentialsInput {
        access_key_id: request.access_key_id.clone(),
        secret_access_key: request.secret_access_key.clone(),
        region: request.region.clone(),
    })
    .await?;

    let pool = repository::pool().await?;
    let account_id = request.id.unwrap_or_else(|| format!("aws-{}", uuid::Uuid::new_v4()));
    let now = Utc::now();
    let mut account = AwsAccount {
        id: account_id.clone(),
        name: request.name.trim().to_string(),
        region: request.region,
        access_key_id_masked: mask_access_key(&request.access_key_id),
        identity: Some(identity),
        is_active: request.make_active,
        created_at: now,
        updated_at: now,
    };

    save_account_credentials(&account_id, &request.access_key_id, &request.secret_access_key)?;

    if account.is_active {
        let accounts = repository::list_aws_accounts(&pool).await?;
        for mut existing in accounts {
            existing.is_active = false;
            repository::upsert_aws_account(&pool, &existing).await?;
        }
    } else if repository::active_aws_account(&pool).await?.is_none() {
        account.is_active = true;
    }

    repository::upsert_aws_account(&pool, &account).await?;

    Ok(account)
}

#[tauri::command]
pub async fn set_active_aws_account(request: serde_json::Value) -> AppResult<AwsAccountSummary> {
    let account_id = request
        .get("accountId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::validation("accountId is required."))?;
    let pool = repository::pool().await?;
    repository::set_active_aws_account(&pool, account_id).await?;
    repository::get_aws_account(&pool, account_id)
        .await?
        .map(AwsAccountSummary::from)
        .ok_or_else(|| AppError::validation(format!("AWS account {account_id} was not found.")))
}

#[tauri::command]
pub async fn delete_aws_account(request: serde_json::Value) -> AppResult<Vec<AwsAccountSummary>> {
    let account_id = request
        .get("accountId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::validation("accountId is required."))?;
    let pool = repository::pool().await?;
    let _ = clear_account_credentials(account_id);
    repository::delete_aws_account(&pool, account_id).await?;

    let mut accounts = repository::list_aws_accounts(&pool).await?;
    if !accounts.iter().any(|account| account.is_active) {
        if let Some(first) = accounts.first_mut() {
            first.is_active = true;
            repository::upsert_aws_account(&pool, first).await?;
        }
    }

    list_aws_accounts().await
}

#[tauri::command]
pub async fn clear_aws_account_credentials(request: serde_json::Value) -> AppResult<()> {
    let account_id = request
        .get("accountId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::validation("accountId is required."))?;
    clear_account_credentials(account_id)
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
        .map_err(|_| AppError::internal("Settings lock was poisoned."))? = settings.clone();

    Ok(settings)
}

#[tauri::command]
pub async fn get_aws_settings(state: State<'_, AppState>) -> AppResult<AwsSettings> {
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|_| AppError::internal("Settings lock was poisoned."))
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
        .map_err(|_| AppError::internal("Settings lock was poisoned."))? = settings.clone();

    Ok(settings)
}

impl From<AwsAccount> for AwsAccountSummary {
    fn from(account: AwsAccount) -> Self {
        Self {
            id: account.id,
            name: account.name,
            region: account.region,
            access_key_id_masked: account.access_key_id_masked,
            identity: account.identity,
            is_active: account.is_active,
        }
    }
}

fn mask_access_key(access_key_id: &str) -> String {
    let trimmed = access_key_id.trim();
    if trimmed.len() <= 8 {
        return "********".to_string();
    }
    format!("{}****{}", &trimmed[..4], &trimmed[trimmed.len() - 4..])
}
