mod assume_role;
mod mfa;
mod session;
pub mod sso;

use crate::aws::credentials::read_account_credentials;
use crate::error::AppResult;
use crate::models::{
    AwsAccount, AwsAccountAuthStatus, AwsAuthMethod, AwsAuthStatusKind,
};
use chrono::Utc;
use session::{
    clear_all_auth_secrets, mask_key_prefix, read_cached_session, sdk_config_from_static,
};
use tauri::AppHandle;

pub use assume_role::{assume_role, resolve_assume_role_config};
pub use mfa::{resolve_mfa_config, submit_mfa_code};
pub use session::{clear_all_auth_secrets as clear_account_auth_secrets, clear_cached_session};
pub use sso::{has_usable_sso_session, sign_out as sso_sign_out, start_device_login};

#[derive(Debug, Clone)]
pub struct ResolvedAwsAuth {
    pub config: aws_config::SdkConfig,
    pub session_expires_at: Option<chrono::DateTime<Utc>>,
    /// Short label for diagnostics / AccessDenied hints, e.g. `mfaSession:ASIA…`.
    pub fingerprint: String,
}

pub async fn resolve_sdk_config(
    app: &AppHandle,
    account: &AwsAccount,
) -> AppResult<(aws_config::SdkConfig, Option<chrono::DateTime<Utc>>)> {
    let resolved = resolve_aws_auth(app, account).await?;
    Ok((resolved.config, resolved.session_expires_at))
}

pub async fn resolve_aws_auth(app: &AppHandle, account: &AwsAccount) -> AppResult<ResolvedAwsAuth> {
    match account.auth_method {
        AwsAuthMethod::AccessKey => {
            let credentials = read_account_credentials(app, &account.id)?;
            let fingerprint = format!(
                "accessKey:{}",
                mask_key_prefix(&credentials.access_key_id)
            );
            let config = sdk_config_from_static(&credentials, &account.region).await;
            Ok(ResolvedAwsAuth {
                config,
                session_expires_at: None,
                fingerprint,
            })
        }
        AwsAuthMethod::Sso => {
            let (config, expires) = sso::resolve_sso_config(app, account).await?;
            let fingerprint = match read_cached_session(app, &account.id)? {
                Some(session) => format!("sso:{}", session.fingerprint()),
                None => "sso:unknown".to_string(),
            };
            Ok(ResolvedAwsAuth {
                config,
                session_expires_at: expires,
                fingerprint,
            })
        }
        AwsAuthMethod::MfaSession => {
            let (config, expires) = resolve_mfa_config(app, account).await?;
            let fingerprint = match read_cached_session(app, &account.id)? {
                Some(session) => format!("mfaSession:{}", session.fingerprint()),
                None => "mfaSession:unknown".to_string(),
            };
            Ok(ResolvedAwsAuth {
                config,
                session_expires_at: expires,
                fingerprint,
            })
        }
        AwsAuthMethod::AssumeRole => {
            let (config, expires) = resolve_assume_role_config(app, account).await?;
            let fingerprint = match read_cached_session(app, &account.id)? {
                Some(session) => format!("assumeRole:{}", session.fingerprint()),
                None => "assumeRole:unknown".to_string(),
            };
            Ok(ResolvedAwsAuth {
                config,
                session_expires_at: expires,
                fingerprint,
            })
        }
    }
}

pub fn auth_status(app: &AppHandle, account: &AwsAccount) -> AppResult<AwsAccountAuthStatus> {
    let cached = read_cached_session(app, &account.id)?;
    let usable = cached.as_ref().is_some_and(|session| session.is_usable());
    let expires_at = cached.as_ref().map(|session| session.expires_at);

    let (status, message) = match account.auth_method {
        AwsAuthMethod::AccessKey => (AwsAuthStatusKind::SignedIn, None),
        AwsAuthMethod::Sso => {
            if usable {
                (AwsAuthStatusKind::SignedIn, None)
            } else if has_usable_sso_session(app, &account.id)? {
                (
                    AwsAuthStatusKind::Expired,
                    Some("SSO role session expired; refreshing on next use.".into()),
                )
            } else {
                (
                    AwsAuthStatusKind::NeedsLogin,
                    Some("Sign in with AWS IAM Identity Center to continue.".into()),
                )
            }
        }
        AwsAuthMethod::MfaSession => {
            if usable {
                (AwsAuthStatusKind::SignedIn, None)
            } else {
                (
                    AwsAuthStatusKind::NeedsMfa,
                    Some("Enter an MFA code to obtain a temporary session.".into()),
                )
            }
        }
        AwsAuthMethod::AssumeRole => {
            if usable {
                (AwsAuthStatusKind::SignedIn, None)
            } else if account
                .mfa_serial
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty())
            {
                (
                    AwsAuthStatusKind::NeedsMfa,
                    Some("Enter an MFA code to assume the role.".into()),
                )
            } else if expires_at.is_some() {
                (
                    AwsAuthStatusKind::Expired,
                    Some("Assumed-role session expired.".into()),
                )
            } else {
                (AwsAuthStatusKind::SignedIn, None)
            }
        }
    };

    Ok(AwsAccountAuthStatus {
        account_id: account.id.clone(),
        auth_method: account.auth_method,
        status,
        session_expires_at: expires_at,
        message,
    })
}

pub fn wipe_account_secrets(app: &AppHandle, account_id: &str) -> AppResult<()> {
    clear_all_auth_secrets(app, account_id)
}
