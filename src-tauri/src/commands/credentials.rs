use crate::aws::auth::{
    assume_role, auth_status, has_usable_sso_session, resolve_sdk_config, sso_sign_out,
    start_device_login, submit_mfa_code,
};
use crate::aws::cli_profiles::{discover_aws_cli_profiles, load_aws_cli_profile_credentials};
use crate::aws::credentials::{
    aws_config_from_credentials, clear_account_credentials,
    clear_credentials as clear_saved_credentials, read_account_credentials,
    save_account_credentials, save_credentials,
};
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsAccount, AwsAccountAuthStatus, AwsAccountCredentialsInput, AwsAccountSummary,
    AwsAccountUpdateInput, AwsAuthMethod, AwsCliProfileCredentials, AwsCliProfileSummary,
    AwsCredentialsInput, AwsIdentity, AwsMfaCodeRequest, AwsMfaCodeResult, AwsSettings,
    AwsSsoLoginRequest, AwsSsoLoginResult, ImportAwsCliProfileRequest, TestAwsAccountRequest,
};
use crate::state::AppState;
use chrono::Utc;
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

#[tauri::command]
pub async fn test_aws_credentials(request: AwsCredentialsInput) -> AppResult<AwsIdentity> {
    let config = aws_config_from_credentials(&request).await;
    identity_from_config(&config).await
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

    let account_id = request
        .id
        .clone()
        .unwrap_or_else(|| format!("aws-{}", uuid::Uuid::new_v4()));

    match request.auth_method {
        AwsAuthMethod::AccessKey => create_access_key_account(&app, request, account_id).await,
        AwsAuthMethod::Sso => create_sso_account(&app, request, account_id).await,
        AwsAuthMethod::MfaSession => create_mfa_account(&app, request, account_id).await,
        AwsAuthMethod::AssumeRole => create_assume_role_account(&app, request, account_id).await,
    }
}

async fn create_access_key_account(
    app: &AppHandle,
    request: AwsAccountCredentialsInput,
    account_id: String,
) -> AppResult<AwsAccount> {
    if request.access_key_id.trim().is_empty() {
        return Err(AppError::validation("Access Key ID is required."));
    }
    if request.secret_access_key.trim().is_empty() {
        return Err(AppError::validation("Secret Access Key is required."));
    }
    ensure_account_name_unused(request.name.trim(), request.id.as_deref()).await?;

    let identity = test_aws_credentials(AwsCredentialsInput {
        access_key_id: request.access_key_id.clone(),
        secret_access_key: request.secret_access_key.clone(),
        session_token: request.session_token.clone(),
        region: request.region.clone(),
    })
    .await?;

    let account = build_account_base(
        account_id,
        request.name.trim().to_string(),
        request.region,
        AwsAuthMethod::AccessKey,
        mask_access_key(&request.access_key_id),
        Some(identity),
        request.make_active,
    );

    save_account_with_credentials(
        app,
        account,
        &request.access_key_id,
        &request.secret_access_key,
        request.session_token.as_deref(),
    )
    .await
}

async fn create_sso_account(
    app: &AppHandle,
    request: AwsAccountCredentialsInput,
    account_id: String,
) -> AppResult<AwsAccount> {
    let start_url = required_opt(request.sso_start_url.as_deref(), "SSO start URL is required.")?;
    let sso_region = required_opt(
        request
            .sso_region
            .as_deref()
            .or(Some(request.region.as_str())),
        "SSO region is required.",
    )?;
    let sso_account_id =
        required_opt(request.sso_account_id.as_deref(), "SSO account ID is required.")?;
    let sso_role_name =
        required_opt(request.sso_role_name.as_deref(), "SSO role name is required.")?;
    ensure_account_name_unused(request.name.trim(), request.id.as_deref()).await?;

    let mut account = build_account_base(
        account_id,
        request.name.trim().to_string(),
        request.region,
        AwsAuthMethod::Sso,
        format!("sso:{sso_account_id}/{sso_role_name}"),
        None,
        request.make_active,
    );
    account.sso_start_url = Some(start_url);
    account.sso_region = Some(sso_region);
    account.sso_account_id = Some(sso_account_id);
    account.sso_role_name = Some(sso_role_name);

    persist_account(app, account).await
}

async fn create_mfa_account(
    app: &AppHandle,
    request: AwsAccountCredentialsInput,
    account_id: String,
) -> AppResult<AwsAccount> {
    if request.access_key_id.trim().is_empty() {
        return Err(AppError::validation("Access Key ID is required."));
    }
    if request.secret_access_key.trim().is_empty() {
        return Err(AppError::validation("Secret Access Key is required."));
    }
    let mfa_serial = required_opt(request.mfa_serial.as_deref(), "MFA serial / ARN is required.")?;
    ensure_account_name_unused(request.name.trim(), request.id.as_deref()).await?;

    let mut account = build_account_base(
        account_id,
        request.name.trim().to_string(),
        request.region,
        AwsAuthMethod::MfaSession,
        mask_access_key(&request.access_key_id),
        None,
        request.make_active,
    );
    account.mfa_serial = Some(mfa_serial);

    save_account_with_credentials(
        app,
        account,
        &request.access_key_id,
        &request.secret_access_key,
        None,
    )
    .await
}

async fn create_assume_role_account(
    app: &AppHandle,
    request: AwsAccountCredentialsInput,
    account_id: String,
) -> AppResult<AwsAccount> {
    if request.access_key_id.trim().is_empty() {
        return Err(AppError::validation("Access Key ID is required."));
    }
    if request.secret_access_key.trim().is_empty() {
        return Err(AppError::validation("Secret Access Key is required."));
    }
    let role_arn = required_opt(request.role_arn.as_deref(), "Role ARN is required.")?;
    ensure_account_name_unused(request.name.trim(), request.id.as_deref()).await?;

    let mut account = build_account_base(
        account_id.clone(),
        request.name.trim().to_string(),
        request.region.clone(),
        AwsAuthMethod::AssumeRole,
        mask_access_key(&request.access_key_id),
        None,
        request.make_active,
    );
    account.role_arn = Some(role_arn.clone());
    account.external_id = trim_opt(request.external_id);
    account.role_session_name = trim_opt(request.role_session_name);
    account.mfa_serial = trim_opt(request.mfa_serial);

    let saved = save_account_with_credentials(
        app,
        account,
        &request.access_key_id,
        &request.secret_access_key,
        None,
    )
    .await?;

    if saved
        .mfa_serial
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return Ok(saved);
    }

    match assume_role(app, &saved, None).await {
        Ok(result) => {
            let pool = repository::pool().await?;
            let mut account = repository::get_aws_account(&pool, &saved.id)
                .await?
                .ok_or_else(|| AppError::validation("AWS account was not found after create."))?;
            account.identity = Some(result.identity);
            account.session_expires_at = Some(result.session_expires_at);
            account.updated_at = Utc::now();
            repository::upsert_aws_account(&pool, &account).await?;
            Ok(account)
        }
        Err(_) => Ok(saved),
    }
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
    let account_name = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(profile.profile_name.as_str());
    ensure_account_name_unused(account_name, None).await?;
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

    create_aws_account(
        app,
        AwsAccountCredentialsInput {
            id: Some(format!(
                "aws-profile-{}",
                sanitize_profile_id(&profile.profile_name)
            )),
            name: account_name.to_string(),
            auth_method: AwsAuthMethod::AccessKey,
            access_key_id: profile.access_key_id,
            secret_access_key: profile.secret_access_key,
            session_token: profile.session_token,
            region,
            make_active: request.make_active,
            sso_start_url: None,
            sso_region: None,
            sso_account_id: None,
            sso_role_name: None,
            mfa_serial: None,
            role_arn: None,
            external_id: None,
            role_session_name: None,
        },
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
    account: AwsAccount,
    access_key_id: &str,
    secret_access_key: &str,
    session_token: Option<&str>,
) -> AppResult<AwsAccount> {
    save_account_credentials(
        app,
        &account.id,
        access_key_id,
        secret_access_key,
        session_token,
    )?;
    persist_account(app, account).await
}

async fn persist_account(app: &AppHandle, mut account: AwsAccount) -> AppResult<AwsAccount> {
    let pool = repository::pool().await?;
    let now = Utc::now();
    if account.created_at.timestamp() == 0 {
        account.created_at = now;
    }
    account.updated_at = now;

    if account.is_active {
        let accounts = repository::list_aws_accounts(&pool).await?;
        for mut existing in accounts {
            existing.is_active = false;
            repository::upsert_aws_account(&pool, &existing).await?;
        }
    } else if repository::active_aws_account(&pool).await?.is_none() {
        account.is_active = true;
    }

    // Preserve created_at when upserting an already-timed account.
    if let Some(existing) = repository::get_aws_account(&pool, &account.id).await? {
        account.created_at = existing.created_at;
    } else {
        account.created_at = now;
    }

    repository::upsert_aws_account(&pool, &account).await?;
    let _ = app;
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

    ensure_account_name_unused(name, Some(account_id)).await?;
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

    ensure_account_name_unused(name, Some(request.account_id.as_str())).await?;
    let pool = repository::pool().await?;
    let mut account = repository::get_aws_account(&pool, &request.account_id)
        .await?
        .ok_or_else(|| {
            AppError::validation(format!("AWS account {} was not found.", request.account_id))
        })?;

    account.name = name.to_string();
    account.region = region.to_string();
    account.updated_at = Utc::now();

    match account.auth_method {
        AwsAuthMethod::AccessKey | AwsAuthMethod::MfaSession | AwsAuthMethod::AssumeRole => {
            let secret_access_key = request
                .secret_access_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let stored = read_account_credentials(&app, &account.id)?;
            if let Some(secret) = secret_access_key {
                // Keep imported STS token only for AccessKey accounts. MFA /
                // AssumeRole temporary sessions live under separate secret keys.
                let imported_token = matches!(account.auth_method, AwsAuthMethod::AccessKey)
                    .then(|| stored.session_token.as_deref())
                    .flatten();
                save_account_credentials(
                    &app,
                    &account.id,
                    &stored.access_key_id,
                    secret,
                    imported_token,
                )?;
            }

            if matches!(account.auth_method, AwsAuthMethod::AccessKey) {
                let credentials = AwsCredentialsInput {
                    access_key_id: stored.access_key_id.clone(),
                    secret_access_key: secret_access_key
                        .unwrap_or(stored.secret_access_key.as_str())
                        .to_string(),
                    session_token: stored.session_token.clone(),
                    region: region.to_string(),
                };
                account.identity = Some(test_aws_credentials(credentials).await?);
            }

            if matches!(account.auth_method, AwsAuthMethod::MfaSession) {
                if let Some(serial) = trim_opt(request.mfa_serial.clone()) {
                    account.mfa_serial = Some(serial);
                }
            }

            if matches!(account.auth_method, AwsAuthMethod::AssumeRole) {
                if let Some(role_arn) = trim_opt(request.role_arn) {
                    account.role_arn = Some(role_arn);
                }
                if request.external_id.is_some() {
                    account.external_id = trim_opt(request.external_id);
                }
                if request.role_session_name.is_some() {
                    account.role_session_name = trim_opt(request.role_session_name);
                }
                if request.mfa_serial.is_some() {
                    account.mfa_serial = trim_opt(request.mfa_serial);
                }
            }
        }
        AwsAuthMethod::Sso => {
            if let Some(start_url) = trim_opt(request.sso_start_url) {
                account.sso_start_url = Some(start_url);
            }
            if let Some(sso_region) = trim_opt(request.sso_region) {
                account.sso_region = Some(sso_region);
            }
            if let Some(sso_account_id) = trim_opt(request.sso_account_id) {
                account.sso_account_id = Some(sso_account_id);
            }
            if let Some(sso_role_name) = trim_opt(request.sso_role_name) {
                account.sso_role_name = Some(sso_role_name);
            }
            if let (Some(account_id), Some(role_name)) = (
                account.sso_account_id.as_deref(),
                account.sso_role_name.as_deref(),
            ) {
                account.access_key_id_masked = format!("sso:{account_id}/{role_name}");
            }
        }
    }

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
    let mut account = repository::get_aws_account(&pool, &request.account_id)
        .await?
        .ok_or_else(|| {
            AppError::validation(format!("AWS account {} was not found.", request.account_id))
        })?;
    account.region = region.to_string();

    match account.auth_method {
        AwsAuthMethod::AccessKey => {
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
        AwsAuthMethod::Sso => {
            if !has_usable_sso_session(&app, &account.id)? {
                return Err(AppError::auth_required(
                    "SsoLoginRequired",
                    account.id,
                    "Sign in with AWS IAM Identity Center before testing this account.",
                ));
            }
            let (config, _) = resolve_sdk_config(&app, &account).await?;
            identity_from_config(&config).await
        }
        AwsAuthMethod::MfaSession | AwsAuthMethod::AssumeRole => {
            let (config, _) = resolve_sdk_config(&app, &account).await?;
            identity_from_config(&config).await
        }
    }
}

#[tauri::command]
pub async fn get_aws_account_auth_status(
    app: AppHandle,
    request: serde_json::Value,
) -> AppResult<AwsAccountAuthStatus> {
    let account_id = request
        .get("accountId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::validation("accountId is required."))?;
    let pool = repository::pool().await?;
    let account = repository::get_aws_account(&pool, account_id)
        .await?
        .ok_or_else(|| AppError::validation(format!("AWS account {account_id} was not found.")))?;
    auth_status(&app, &account)
}

#[tauri::command]
pub async fn start_aws_sso_login(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AwsSsoLoginRequest,
) -> AppResult<AwsSsoLoginResult> {
    let pool = repository::pool().await?;
    let account = repository::get_aws_account(&pool, &request.account_id)
        .await?
        .ok_or_else(|| {
            AppError::validation(format!(
                "AWS account {} was not found.",
                request.account_id
            ))
        })?;
    if account.auth_method != AwsAuthMethod::Sso {
        return Err(AppError::validation(
            "SSO login is only available for SSO accounts.",
        ));
    }

    let cancel = CancellationToken::new();
    {
        let mut map = state
            .sso_login_cancellations
            .lock()
            .map_err(|_| AppError::internal("SSO login lock was poisoned."))?;
        if let Some(existing) = map.insert(account.id.clone(), cancel.clone()) {
            existing.cancel();
        }
    }

    let result = start_device_login(&app, &account, cancel).await;
    {
        let mut map = state
            .sso_login_cancellations
            .lock()
            .map_err(|_| AppError::internal("SSO login lock was poisoned."))?;
        map.remove(&account.id);
    }
    let result = result?;

    let mut account = repository::get_aws_account(&pool, &request.account_id)
        .await?
        .ok_or_else(|| AppError::validation("AWS account was not found after SSO login."))?;
    account.identity = result.identity.clone();
    account.session_expires_at = result.session_expires_at;
    account.updated_at = Utc::now();
    repository::upsert_aws_account(&pool, &account).await?;

    Ok(result)
}

#[tauri::command]
pub async fn cancel_aws_sso_login(
    state: State<'_, AppState>,
    request: AwsSsoLoginRequest,
) -> AppResult<()> {
    let mut map = state
        .sso_login_cancellations
        .lock()
        .map_err(|_| AppError::internal("SSO login lock was poisoned."))?;
    if let Some(token) = map.remove(&request.account_id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn sign_out_aws_sso(
    app: AppHandle,
    request: AwsSsoLoginRequest,
) -> AppResult<AwsAccountSummary> {
    let pool = repository::pool().await?;
    let mut account = repository::get_aws_account(&pool, &request.account_id)
        .await?
        .ok_or_else(|| {
            AppError::validation(format!(
                "AWS account {} was not found.",
                request.account_id
            ))
        })?;
    if account.auth_method != AwsAuthMethod::Sso {
        return Err(AppError::validation(
            "SSO sign-out is only available for SSO accounts.",
        ));
    }
    sso_sign_out(&app, &account.id)?;
    account.identity = None;
    account.session_expires_at = None;
    account.updated_at = Utc::now();
    repository::upsert_aws_account(&pool, &account).await?;
    Ok(AwsAccountSummary::from(account))
}

#[tauri::command]
pub async fn submit_aws_mfa_code(
    app: AppHandle,
    request: AwsMfaCodeRequest,
) -> AppResult<AwsMfaCodeResult> {
    let pool = repository::pool().await?;
    let mut account = repository::get_aws_account(&pool, &request.account_id)
        .await?
        .ok_or_else(|| {
            AppError::validation(format!(
                "AWS account {} was not found.",
                request.account_id
            ))
        })?;

    let result = match account.auth_method {
        AwsAuthMethod::MfaSession => submit_mfa_code(&app, &account, &request.token_code).await?,
        AwsAuthMethod::AssumeRole => {
            assume_role(&app, &account, Some(request.token_code.as_str())).await?
        }
        _ => {
            return Err(AppError::validation(
                "MFA codes are only used for MFA session or AssumeRole accounts.",
            ));
        }
    };

    account.identity = Some(result.identity.clone());
    account.session_expires_at = Some(result.session_expires_at);
    account.updated_at = Utc::now();
    repository::upsert_aws_account(&pool, &account).await?;
    Ok(result)
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

    if let Ok((connection_ids, profile_ids)) =
        crate::db::dbhub::delete_all_for_account(&pool, account_id).await
    {
        for id in connection_ids.iter().chain(profile_ids.iter()) {
            let _ = crate::secrets::delete_secret(&app, &format!("db/{id}/password"));
            let _ = crate::secrets::delete_secret(&app, &format!("profile/{id}/password"));
        }
    }

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
            auth_method: account.auth_method,
            access_key_id_masked: account.access_key_id_masked,
            sso_start_url: account.sso_start_url,
            sso_account_id: account.sso_account_id,
            sso_role_name: account.sso_role_name,
            mfa_serial: account.mfa_serial,
            role_arn: account.role_arn,
            session_expires_at: account.session_expires_at,
            identity: account.identity,
            is_active: account.is_active,
        }
    }
}

async fn identity_from_config(config: &aws_config::SdkConfig) -> AppResult<AwsIdentity> {
    let client = aws_sdk_sts::Client::new(config);
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

fn mask_access_key(access_key_id: &str) -> String {
    let trimmed = access_key_id.trim();
    if trimmed.len() <= 8 {
        return "********".to_string();
    }
    format!("{}****{}", &trimmed[..4], &trimmed[trimmed.len() - 4..])
}

fn build_account_base(
    id: String,
    name: String,
    region: String,
    auth_method: AwsAuthMethod,
    access_key_id_masked: String,
    identity: Option<AwsIdentity>,
    is_active: bool,
) -> AwsAccount {
    let now = Utc::now();
    AwsAccount {
        id,
        name,
        region,
        auth_method,
        access_key_id_masked,
        sso_start_url: None,
        sso_region: None,
        sso_account_id: None,
        sso_role_name: None,
        mfa_serial: None,
        role_arn: None,
        external_id: None,
        role_session_name: None,
        session_expires_at: None,
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

fn required_opt(value: Option<&str>, message: &str) -> AppResult<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation(message.to_string()))
}

fn trim_opt(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Account display names are the uniqueness key across all auth methods.
/// Access keys are intentionally not unique: the same key may back Access Key,
/// MFA session, and Assume Role accounts under different names.
async fn ensure_account_name_unused(
    name: &str,
    skip_account_id: Option<&str>,
) -> AppResult<()> {
    let normalized = normalize_account_name(name);
    if normalized.is_empty() {
        return Err(AppError::validation("Account name is required."));
    }

    let pool = repository::pool().await?;
    let existing = repository::list_aws_accounts(&pool)
        .await?
        .into_iter()
        .find(|account| {
            normalize_account_name(&account.name) == normalized
                && skip_account_id.is_none_or(|id| account.id != id)
        });

    match existing {
        Some(account) => Err(AppError::validation(format!(
            "An account named \"{}\" already exists. Choose a different name.",
            account.name
        ))),
        None => Ok(()),
    }
}

fn normalize_account_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}
