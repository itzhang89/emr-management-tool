use super::session::{
    clear_cached_session, clear_sso_token_secrets, read_cached_session, read_sso_access_token,
    read_sso_client, read_sso_refresh_token, save_cached_session, sdk_config_from_session,
    write_sso_client, write_sso_tokens, CachedSession, SESSION_SKEW,
};
use crate::error::{AppError, AppResult};
use crate::models::{AwsAccount, AwsIdentity, AwsSsoLoginResult};
use aws_config::BehaviorVersion;
use aws_types::region::Region;
use chrono::{Duration, TimeZone, Utc};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

fn sso_region(account: &AwsAccount) -> AppResult<&str> {
    account
        .sso_region
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("SSO region is required."))
}

fn sso_start_url(account: &AwsAccount) -> AppResult<&str> {
    account
        .sso_start_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("SSO start URL is required."))
}

fn sso_account_id(account: &AwsAccount) -> AppResult<&str> {
    account
        .sso_account_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("SSO account ID is required."))
}

fn sso_role_name(account: &AwsAccount) -> AppResult<&str> {
    account
        .sso_role_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("SSO role name is required."))
}

async fn oidc_client(region: &str) -> aws_sdk_ssooidc::Client {
    let config = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(region.to_string()))
        .load()
        .await;
    aws_sdk_ssooidc::Client::new(&config)
}

async fn sso_client(region: &str) -> aws_sdk_sso::Client {
    let config = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(region.to_string()))
        .load()
        .await;
    aws_sdk_sso::Client::new(&config)
}

async fn ensure_oidc_client(
    app: &AppHandle,
    account: &AwsAccount,
) -> AppResult<(String, String)> {
    if let Some((client_id, client_secret, _)) = read_sso_client(app, &account.id)? {
        return Ok((client_id, client_secret));
    }

    let region = sso_region(account)?;
    let client = oidc_client(region).await;
    let registered = client
        .register_client()
        .client_name("emr-management-tool")
        .client_type("public")
        .scopes("sso:account:access")
        .send()
        .await
        .map_err(|error| AppError::aws_sdk("sso-oidc", error))?;

    let client_id = registered
        .client_id()
        .ok_or_else(|| AppError::internal("SSO RegisterClient did not return client_id."))?
        .to_string();
    let client_secret = registered
        .client_secret()
        .ok_or_else(|| AppError::internal("SSO RegisterClient did not return client_secret."))?
        .to_string();
    let expires_at = {
        let epoch = registered.client_secret_expires_at();
        if epoch > 0 {
            Utc.timestamp_opt(epoch, 0).single()
        } else {
            None
        }
    };
    write_sso_client(app, &account.id, &client_id, &client_secret, expires_at)?;
    Ok((client_id, client_secret))
}

async fn fetch_role_credentials(
    app: &AppHandle,
    account: &AwsAccount,
    access_token: &str,
) -> AppResult<CachedSession> {
    let region = sso_region(account)?;
    let client = sso_client(region).await;
    let response = client
        .get_role_credentials()
        .account_id(sso_account_id(account)?)
        .role_name(sso_role_name(account)?)
        .access_token(access_token)
        .send()
        .await
        .map_err(|error| AppError::aws_sdk("sso", error))?;

    let credentials = response
        .role_credentials()
        .ok_or_else(|| AppError::internal("SSO GetRoleCredentials returned no credentials."))?;
    let access_key_id = credentials
        .access_key_id()
        .ok_or_else(|| AppError::internal("SSO role credentials missing access key."))?
        .to_string();
    let secret_access_key = credentials
        .secret_access_key()
        .ok_or_else(|| AppError::internal("SSO role credentials missing secret key."))?
        .to_string();
    let session_token = credentials
        .session_token()
        .ok_or_else(|| AppError::internal("SSO role credentials missing session token."))?
        .to_string();
    let expires_at = Utc
        .timestamp_millis_opt(credentials.expiration())
        .single()
        .unwrap_or_else(|| Utc::now() + Duration::hours(1));

    save_cached_session(
        app,
        &account.id,
        &access_key_id,
        &secret_access_key,
        &session_token,
        expires_at,
    )?;

    Ok(CachedSession {
        access_key_id,
        secret_access_key,
        session_token,
        expires_at,
    })
}

async fn refresh_access_token(
    app: &AppHandle,
    account: &AwsAccount,
) -> AppResult<Option<String>> {
    let Some(refresh_token) = read_sso_refresh_token(app, &account.id)? else {
        return Ok(None);
    };
    let Some((client_id, client_secret, _)) = read_sso_client(app, &account.id)? else {
        return Ok(None);
    };

    let region = sso_region(account)?;
    let client = oidc_client(region).await;
    let response = match client
        .create_token()
        .client_id(client_id)
        .client_secret(client_secret)
        .grant_type("refresh_token")
        .refresh_token(&refresh_token)
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return Ok(None),
    };

    let access_token = match response.access_token() {
        Some(token) if !token.is_empty() => token.to_string(),
        _ => return Ok(None),
    };
    let expires_in = response.expires_in().max(60) as i64;
    let expires_at = Utc::now() + Duration::seconds(expires_in);
    let new_refresh = response
        .refresh_token()
        .map(str::to_string)
        .unwrap_or(refresh_token);
    write_sso_tokens(
        app,
        &account.id,
        &access_token,
        expires_at,
        Some(new_refresh.as_str()),
    )?;
    Ok(Some(access_token))
}

async fn ensure_access_token(app: &AppHandle, account: &AwsAccount) -> AppResult<String> {
    if let Some((token, expires_at)) = read_sso_access_token(app, &account.id)? {
        if expires_at > Utc::now() + SESSION_SKEW {
            return Ok(token);
        }
    }
    if let Some(token) = refresh_access_token(app, account).await? {
        return Ok(token);
    }
    Err(AppError::auth_required(
        "SsoLoginRequired",
        account.id.clone(),
        "Sign in with AWS IAM Identity Center (SSO) before using this account.",
    ))
}

pub async fn resolve_sso_config(
    app: &AppHandle,
    account: &AwsAccount,
) -> AppResult<(aws_config::SdkConfig, Option<chrono::DateTime<Utc>>)> {
    if let Some(session) = read_cached_session(app, &account.id)? {
        if session.is_usable() {
            let config = sdk_config_from_session(&session, &account.region).await;
            return Ok((config, Some(session.expires_at)));
        }
    }

    let access_token = ensure_access_token(app, account).await?;
    let session = fetch_role_credentials(app, account, &access_token).await?;
    let config = sdk_config_from_session(&session, &account.region).await;
    Ok((config, Some(session.expires_at)))
}

pub async fn caller_identity(config: &aws_config::SdkConfig) -> AppResult<AwsIdentity> {
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

pub fn open_system_browser(url: &str) -> AppResult<()> {
    open::that(url).map_err(|error| {
        AppError::internal(format!("Failed to open the system browser: {error}"))
    })
}

pub async fn start_device_login(
    app: &AppHandle,
    account: &AwsAccount,
    cancel: CancellationToken,
) -> AppResult<AwsSsoLoginResult> {
    let start_url = sso_start_url(account)?.to_string();
    let region = sso_region(account)?.to_string();
    let (client_id, client_secret) = ensure_oidc_client(app, account).await?;
    let oidc = oidc_client(&region).await;

    let authorization = oidc
        .start_device_authorization()
        .client_id(&client_id)
        .client_secret(&client_secret)
        .start_url(&start_url)
        .send()
        .await
        .map_err(|error| AppError::aws_sdk("sso-oidc", error))?;

    let device_code = authorization
        .device_code()
        .ok_or_else(|| AppError::internal("SSO device authorization missing device_code."))?
        .to_string();
    let verification_uri = authorization
        .verification_uri_complete()
        .or_else(|| authorization.verification_uri())
        .ok_or_else(|| AppError::internal("SSO device authorization missing verification URI."))?
        .to_string();
    let interval_secs = authorization.interval().max(1) as u64;
    let expires_in = authorization.expires_in().max(60) as i64;
    let deadline = Utc::now() + Duration::seconds(expires_in);

    open_system_browser(&verification_uri)?;

    loop {
        if cancel.is_cancelled() {
            return Err(AppError::cancelled("SSO login was cancelled."));
        }
        if Utc::now() >= deadline {
            return Err(AppError::validation(
                "SSO login timed out before authorization completed.",
            ));
        }

        tokio::select! {
            _ = cancel.cancelled() => {
                return Err(AppError::cancelled("SSO login was cancelled."));
            }
            _ = tokio::time::sleep(std::time::Duration::from_secs(interval_secs)) => {}
        }

        match oidc
            .create_token()
            .client_id(&client_id)
            .client_secret(&client_secret)
            .grant_type("urn:ietf:params:oauth:grant-type:device_code")
            .device_code(&device_code)
            .send()
            .await
        {
            Ok(token) => {
                let access_token = token
                    .access_token()
                    .ok_or_else(|| AppError::internal("SSO CreateToken missing access_token."))?
                    .to_string();
                let token_expires_in = token.expires_in().max(60) as i64;
                let access_expires_at = Utc::now() + Duration::seconds(token_expires_in);
                write_sso_tokens(
                    app,
                    &account.id,
                    &access_token,
                    access_expires_at,
                    token.refresh_token(),
                )?;

                let session = fetch_role_credentials(app, account, &access_token).await?;
                let config = sdk_config_from_session(&session, &account.region).await;
                let identity = caller_identity(&config).await.ok();

                return Ok(AwsSsoLoginResult {
                    account_id: account.id.clone(),
                    verification_uri,
                    identity,
                    session_expires_at: Some(session.expires_at),
                });
            }
            Err(error) => {
                use aws_smithy_types::error::metadata::ProvideErrorMetadata;
                let code = error.code().unwrap_or_default();
                if code == "AuthorizationPendingException" || code == "SlowDownException" {
                    if code == "SlowDownException" {
                        tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;
                    }
                    continue;
                }
                if code == "ExpiredTokenException" {
                    return Err(AppError::validation(
                        "SSO device authorization expired. Start sign-in again.",
                    ));
                }
                return Err(AppError::aws_sdk("sso-oidc", error));
            }
        }
    }
}

pub fn sign_out(app: &AppHandle, account_id: &str) -> AppResult<()> {
    clear_cached_session(app, account_id)?;
    clear_sso_token_secrets(app, account_id)?;
    Ok(())
}

pub fn has_usable_sso_session(app: &AppHandle, account_id: &str) -> AppResult<bool> {
    Ok(read_cached_session(app, account_id)?
        .map(|session| session.is_usable())
        .unwrap_or(false)
        || read_sso_refresh_token(app, account_id)?.is_some()
        || read_sso_access_token(app, account_id)?
            .map(|(_, expires_at)| expires_at > Utc::now() + SESSION_SKEW)
            .unwrap_or(false))
}
