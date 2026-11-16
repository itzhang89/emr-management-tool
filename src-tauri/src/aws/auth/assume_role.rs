use super::mfa::session_from_sts;
use super::session::{
    read_cached_session, save_cached_session, sdk_config_from_session, sdk_config_from_static,
};
use crate::aws::credentials::read_account_credentials;
use crate::error::{AppError, AppResult};
use crate::models::{AwsAccount, AwsIdentity, AwsMfaCodeResult};
use chrono::Utc;
use tauri::AppHandle;

fn role_arn(account: &AwsAccount) -> AppResult<&str> {
    account
        .role_arn
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("Role ARN is required for AssumeRole accounts."))
}

fn requires_mfa(account: &AwsAccount) -> bool {
    account
        .mfa_serial
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
}

pub async fn resolve_assume_role_config(
    app: &AppHandle,
    account: &AwsAccount,
) -> AppResult<(aws_config::SdkConfig, Option<chrono::DateTime<Utc>>)> {
    if let Some(session) = read_cached_session(app, &account.id)? {
        if session.is_usable() {
            let config = sdk_config_from_session(&session, &account.region).await;
            return Ok((config, Some(session.expires_at)));
        }
    }

    if requires_mfa(account) {
        return Err(AppError::auth_required(
            "MfaCodeRequired",
            account.id.clone(),
            "Enter an MFA code to assume the configured role.",
        ));
    }

    let result = assume_role(app, account, None).await?;
    let session = read_cached_session(app, &account.id)?
        .ok_or_else(|| AppError::internal("AssumeRole session was not cached."))?;
    let config = sdk_config_from_session(&session, &account.region).await;
    Ok((config, Some(result.session_expires_at)))
}

pub async fn assume_role(
    app: &AppHandle,
    account: &AwsAccount,
    token_code: Option<&str>,
) -> AppResult<AwsMfaCodeResult> {
    if requires_mfa(account) {
        let code = token_code
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::auth_required(
                    "MfaCodeRequired",
                    account.id.clone(),
                    "Enter an MFA code to assume the configured role.",
                )
            })?;
        if code.len() < 6 {
            return Err(AppError::validation(
                "MFA token code must be at least 6 digits.",
            ));
        }
    }

    let base = read_account_credentials(app, &account.id)?;
    let base_config = sdk_config_from_static(&base, &account.region).await;
    let sts = aws_sdk_sts::Client::new(&base_config);

    let session_name = account
        .role_session_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("emr-management-tool");

    let mut request = sts
        .assume_role()
        .role_arn(role_arn(account)?)
        .role_session_name(session_name)
        .duration_seconds(3_600);

    if let Some(external_id) = account
        .external_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request = request.external_id(external_id);
    }

    if let Some(serial) = account
        .mfa_serial
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request = request.serial_number(serial);
        if let Some(code) = token_code.map(str::trim).filter(|value| !value.is_empty()) {
            request = request.token_code(code);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| AppError::aws_sdk("sts", error))?;

    let credentials = response
        .credentials()
        .ok_or_else(|| AppError::internal("AssumeRole returned no credentials."))?;
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
