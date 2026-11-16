use super::session::{
    read_cached_session, save_cached_session, sdk_config_from_session, sdk_config_from_static,
    CachedSession,
};
use crate::aws::credentials::read_account_credentials;
use crate::error::{AppError, AppResult};
use crate::models::{AwsAccount, AwsIdentity, AwsMfaCodeResult};
use chrono::{Duration, TimeZone, Utc};
use tauri::AppHandle;

fn mfa_serial(account: &AwsAccount) -> AppResult<&str> {
    account
        .mfa_serial
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("MFA device serial / ARN is required."))
}

pub async fn resolve_mfa_config(
    app: &AppHandle,
    account: &AwsAccount,
) -> AppResult<(aws_config::SdkConfig, Option<chrono::DateTime<Utc>>)> {
    if let Some(session) = read_cached_session(app, &account.id)? {
        if session.is_usable() {
            let config = sdk_config_from_session(&session, &account.region).await;
            return Ok((config, Some(session.expires_at)));
        }
    }

    Err(AppError::auth_required(
        "MfaCodeRequired",
        account.id.clone(),
        "Enter an MFA code to obtain temporary credentials for this account.",
    ))
}

pub async fn submit_mfa_code(
    app: &AppHandle,
    account: &AwsAccount,
    token_code: &str,
) -> AppResult<AwsMfaCodeResult> {
    let token_code = token_code.trim();
    if token_code.len() < 6 {
        return Err(AppError::validation("MFA token code must be at least 6 digits."));
    }

    let base = read_account_credentials(app, &account.id)?;
    let base_config = sdk_config_from_static(&base, &account.region).await;
    let sts = aws_sdk_sts::Client::new(&base_config);

    let response = sts
        .get_session_token()
        .serial_number(mfa_serial(account)?)
        .token_code(token_code)
        .duration_seconds(43_200)
        .send()
        .await
        .map_err(|error| AppError::aws_sdk("sts", error))?;

    let credentials = response
        .credentials()
        .ok_or_else(|| AppError::internal("GetSessionToken returned no credentials."))?;
    let session = session_from_sts(credentials)?;
    save_cached_session(
        app,
        &account.id,
        &session.access_key_id,
        &session.secret_access_key,
        &session.session_token,
        session.expires_at,
    )?;

    let config = sdk_config_from_session(&session, &account.region).await;
    let identity = caller_identity(&config).await?;

    Ok(AwsMfaCodeResult {
        account_id: account.id.clone(),
        identity,
        session_expires_at: session.expires_at,
    })
}

pub(crate) fn session_from_sts(
    credentials: &aws_sdk_sts::types::Credentials,
) -> AppResult<CachedSession> {
    let access_key_id = credentials.access_key_id().to_string();
    let secret_access_key = credentials.secret_access_key().to_string();
    let session_token = credentials.session_token().to_string();
    let expiration = credentials.expiration();
    let expires_at = Utc
        .timestamp_opt(expiration.secs(), expiration.subsec_nanos())
        .single()
        .unwrap_or_else(|| Utc::now() + Duration::hours(1));

    Ok(CachedSession {
        access_key_id,
        secret_access_key,
        session_token,
        expires_at,
    })
}

async fn caller_identity(config: &aws_config::SdkConfig) -> AppResult<AwsIdentity> {
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
