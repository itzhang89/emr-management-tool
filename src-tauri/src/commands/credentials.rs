use crate::aws::cli_profiles::{discover_aws_cli_profiles, load_aws_cli_profile_credentials};
use crate::aws::credentials::{
    aws_config_from_credentials, clear_account_credentials,
    clear_credentials as clear_saved_credentials, read_account_credentials,
    save_account_credentials, save_credentials,
};
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsAccount, AwsAccountCredentialsInput, AwsAccountSummary, AwsAccountUpdateInput,
    AwsCliProfileCredentials, AwsCliProfileSummary, AwsCredentialsInput, AwsIdentity, AwsSettings,
    ImportAwsCliProfileRequest, TestAwsAccountRequest,
};
use crate::state::AppState;
use chrono::Utc;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn test_aws_credentials(request: AwsCredentialsInput) -> AppResult<AwsIdentity> {
    let config = aws_config_from_credentials(&request).await;
    let client = aws_sdk_sts::Client::new(&config);
    let identity = client
        .get_caller_identity()
        .send()
        .await
        .map_err(|error| AppError::aws_sdk("sts", error))?;

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
pub async fn create_aws_account(
    app: AppHandle,
    request: AwsAccountCredentialsInput,
) -> AppResult<AwsAccount> {
    if request.name.trim().is_empty() {
        return Err(AppError::validation("Account name is required."));
    }
    if request.region.trim().is_empty() {
        return Err(AppError::validation("Region is required."));
    }
    ensure_access_key_unused(&request.access_key_id, request.id.as_deref()).await?;

    let identity = test_aws_credentials(AwsCredentialsInput {
        access_key_id: request.access_key_id.clone(),
        secret_access_key: request.secret_access_key.clone(),
        session_token: request.session_token.clone(),
        region: request.region.clone(),
    })
    .await?;

    let account_id = request
        .id
        .unwrap_or_else(|| format!("aws-{}", uuid::Uuid::new_v4()));
    let account = build_account(
        account_id,
        request.name.trim().to_string(),
        request.region,
        &request.access_key_id,
        Some(identity),
        request.make_active,
    );

    save_account_with_credentials(
        &app,
        account,
        &request.access_key_id,
        &request.secret_access_key,
        request.session_token.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn list_aws_cli_profiles() -> AppResult<Vec<AwsCliProfileSummary>> {
    discover_aws_cli_profiles()
}

#[tauri::command]
pub async fn import_aws_cli_profile(
    app: AppHandle,
    request: ImportAwsCliProfileRequest,
) -> AppResult<AwsAccount> {
    if request.profile_name.trim().is_empty() {
        return Err(AppError::validation("AWS CLI profile name is required."));
    }
    let profile = load_aws_cli_profile_credentials(&request.profile_name)?;
    ensure_access_key_unused(&profile.access_key_id, None).await?;
    let region = request
        .region
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            profile
                .region
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| {
            AppError::validation(
                "Region is required. Choose a region before importing this AWS CLI profile."
                    .to_string(),
            )
        })?
        .to_string();

    let identity = test_aws_credentials(AwsCredentialsInput {
        access_key_id: profile.access_key_id.clone(),
        secret_access_key: profile.secret_access_key.clone(),
        session_token: profile.session_token.clone(),
        region: region.clone(),
    })
    .await?;

    let account_id = format!("aws-profile-{}", sanitize_profile_id(&profile.profile_name));
    let account = build_account(
        account_id,
        request
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(profile.profile_name),
        region,
        &profile.access_key_id,
        Some(identity),
        request.make_active,
    );

    save_account_with_credentials(
        &app,
        account,
        &profile.access_key_id,
        &profile.secret_access_key,
        profile.session_token.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn load_aws_cli_profile(
    request: serde_json::Value,
) -> AppResult<AwsCliProfileCredentials> {
    let profile_name = request
        .get("profileName")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("AWS CLI profile name is required."))?;
    let profile = load_aws_cli_profile_credentials(profile_name)?;
    Ok(AwsCliProfileCredentials {
        profile_name: profile.profile_name,
        access_key_id: profile.access_key_id,
        secret_access_key: profile.secret_access_key,
        session_token: profile.session_token,
        region: profile.region,
    })
}

async fn save_account_with_credentials(
    app: &AppHandle,
    mut account: AwsAccount,
    access_key_id: &str,
    secret_access_key: &str,
    session_token: Option<&str>,
) -> AppResult<AwsAccount> {
    let pool = repository::pool().await?;
    let now = Utc::now();
    account.created_at = now;
    account.updated_at = now;

    save_account_credentials(
        app,
        &account.id,
        access_key_id,
        secret_access_key,
        session_token,
    )?;

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
pub async fn rename_aws_account(request: serde_json::Value) -> AppResult<AwsAccountSummary> {
    let account_id = request
        .get("accountId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::validation("accountId is required."))?;
    let name = request
        .get("name")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("Account name is required."))?;

    let pool = repository::pool().await?;
    let mut account = repository::get_aws_account(&pool, account_id)
        .await?
        .ok_or_else(|| AppError::validation(format!("AWS account {account_id} was not found.")))?;
    account.name = name.to_string();
    account.updated_at = Utc::now();
    repository::upsert_aws_account(&pool, &account).await?;
    Ok(AwsAccountSummary::from(account))
}

#[tauri::command]
pub async fn update_aws_account(
    app: AppHandle,
    request: AwsAccountUpdateInput,
) -> AppResult<AwsAccountSummary> {
    let name = request.name.trim();
    let region = request.region.trim();
    if name.is_empty() {
        return Err(AppError::validation("Account name is required."));
    }
    if region.is_empty() {
        return Err(AppError::validation("Region is required."));
    }

    let secret_access_key = request
        .secret_access_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let pool = repository::pool().await?;
    let mut account = repository::get_aws_account(&pool, &request.account_id)
        .await?
        .ok_or_else(|| {
            AppError::validation(format!("AWS account {} was not found.", request.account_id))
        })?;

    let stored = read_account_credentials(&app, &account.id)?;
    let credentials = AwsCredentialsInput {
        access_key_id: stored.access_key_id.clone(),
        secret_access_key: secret_access_key
            .unwrap_or(stored.secret_access_key.as_str())
            .to_string(),
        session_token: stored.session_token.clone(),
        region: region.to_string(),
    };
    let identity = test_aws_credentials(credentials.clone()).await?;

    if let Some(secret) = secret_access_key {
        save_account_credentials(
            &app,
            &account.id,
            &stored.access_key_id,
            secret,
            stored.session_token.as_deref(),
        )?;
    }

    account.name = name.to_string();
    account.region = region.to_string();
    account.identity = Some(identity);
    account.updated_at = Utc::now();
    repository::upsert_aws_account(&pool, &account).await?;
    Ok(AwsAccountSummary::from(account))
}

#[tauri::command]
pub async fn test_aws_account(
    app: AppHandle,
    request: TestAwsAccountRequest,
) -> AppResult<AwsIdentity> {
    let region = request.region.trim();
    if region.is_empty() {
        return Err(AppError::validation("Region is required."));
    }

    let pool = repository::pool().await?;
    let account = repository::get_aws_account(&pool, &request.account_id)
        .await?
        .ok_or_else(|| {
            AppError::validation(format!("AWS account {} was not found.", request.account_id))
        })?;

    let stored = read_account_credentials(&app, &account.id)?;
    let secret_access_key = request
        .secret_access_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(stored.secret_access_key.as_str());

    test_aws_credentials(AwsCredentialsInput {
        access_key_id: stored.access_key_id,
        secret_access_key: secret_access_key.to_string(),
        session_token: stored.session_token,
        region: region.to_string(),
    })
    .await
}

#[tauri::command]
pub async fn delete_aws_account(
    app: AppHandle,
    request: serde_json::Value,
) -> AppResult<Vec<AwsAccountSummary>> {
    let account_id = request
        .get("accountId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::validation("accountId is required."))?;
    let pool = repository::pool().await?;
    let _ = clear_account_credentials(&app, account_id);
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
pub async fn clear_aws_account_credentials(
    app: AppHandle,
    request: serde_json::Value,
) -> AppResult<()> {
    let account_id = request
        .get("accountId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::validation("accountId is required."))?;
    clear_account_credentials(&app, account_id)
}

#[tauri::command]
pub async fn save_aws_credentials(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AwsCredentialsInput,
) -> AppResult<AwsSettings> {
    let identity = test_aws_credentials(request.clone()).await?;
    save_credentials(&app, &request)?;

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
pub async fn clear_aws_credentials(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<AwsSettings> {
    clear_saved_credentials(&app)?;
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

fn build_account(
    id: String,
    name: String,
    region: String,
    access_key_id: &str,
    identity: Option<AwsIdentity>,
    is_active: bool,
) -> AwsAccount {
    let now = Utc::now();
    AwsAccount {
        id,
        name,
        region,
        access_key_id_masked: mask_access_key(access_key_id),
        identity,
        is_active,
        created_at: now,
        updated_at: now,
    }
}

fn sanitize_profile_id(profile_name: &str) -> String {
    profile_name
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || value == '-' || value == '_' {
                value
            } else {
                '-'
            }
        })
        .collect()
}

/// Rejects a second account for an access key that is already configured.
/// `skip_account_id` lets an edit of an existing account keep its own key.
async fn ensure_access_key_unused(
    access_key_id: &str,
    skip_account_id: Option<&str>,
) -> AppResult<()> {
    let masked = mask_access_key(access_key_id);
    let pool = repository::pool().await?;
    let existing = repository::list_aws_accounts(&pool).await?.into_iter().find(
        |account| {
            account.access_key_id_masked == masked
                && skip_account_id.is_none_or(|id| account.id != id)
        },
    );

    match existing {
        Some(account) => Err(AppError::validation(format!(
            "Access key {masked} is already configured as account \"{}\". Delete that account first if you want to re-import it.",
            account.name
        ))),
        None => Ok(()),
    }
}
