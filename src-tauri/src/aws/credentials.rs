use crate::error::AppResult;
use crate::models::{AwsAccount, AwsCredentialsInput};
use crate::secrets::{
    delete_secret, read_optional_secret, read_secret, write_optional_secret, write_secret,
};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_types::region::Region;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const KEYRING_USER: &str = "default/access_key";
const KEYRING_SECRET: &str = "default/secret_key";
const KEYRING_SESSION_TOKEN: &str = "default/session_token";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAwsCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
}

pub async fn aws_config_from_credentials(
    credentials: &AwsCredentialsInput,
) -> aws_config::SdkConfig {
    let provider = Credentials::new(
        credentials.access_key_id.clone(),
        credentials.secret_access_key.clone(),
        credentials
            .session_token
            .clone()
            .filter(|token| !token.trim().is_empty()),
        None,
        "emr-management-tool",
    );

    aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(credentials.region.clone()))
        .credentials_provider(provider)
        .load()
        .await
}

pub async fn aws_config_from_account(
    app: &AppHandle,
    account: &AwsAccount,
) -> AppResult<aws_config::SdkConfig> {
    let (config, _) = crate::aws::auth::resolve_sdk_config(app, account).await?;
    Ok(config)
}

pub fn credential_key(account_id: &str, secret_name: &str) -> String {
    format!("{account_id}/{secret_name}")
}

pub fn save_account_credentials(
    app: &AppHandle,
    account_id: &str,
    access_key_id: &str,
    secret_access_key: &str,
    session_token: Option<&str>,
) -> AppResult<()> {
    write_secret(
        app,
        &credential_key(account_id, "access_key"),
        access_key_id,
    )?;
    write_secret(
        app,
        &credential_key(account_id, "secret_key"),
        secret_access_key,
    )?;
    // Long-term / imported STS token only — never the MFA/AssumeRole temp token.
    write_optional_secret(
        app,
        &credential_key(account_id, "imported_session_token"),
        session_token,
    )?;
    Ok(())
}

pub fn read_account_credentials(
    app: &AppHandle,
    account_id: &str,
) -> AppResult<StoredAwsCredentials> {
    let imported = read_optional_secret(app, &credential_key(account_id, "imported_session_token"))?;
    // Legacy fallback: only reuse `session_token` when there is no temp MFA/role
    // session, otherwise that shared key may hold GetSessionToken material.
    let has_temp_session =
        read_optional_secret(app, &credential_key(account_id, "session_access_key"))?
            .is_some_and(|value| !value.trim().is_empty());
    let session_token = match imported {
        Some(value) if !value.trim().is_empty() => Some(value),
        _ if !has_temp_session => {
            read_optional_secret(app, &credential_key(account_id, "session_token"))?
        }
        _ => None,
    };

    Ok(StoredAwsCredentials {
        access_key_id: read_secret(app, &credential_key(account_id, "access_key"))?,
        secret_access_key: read_secret(app, &credential_key(account_id, "secret_key"))?,
        session_token,
    })
}

pub fn clear_account_credentials(app: &AppHandle, account_id: &str) -> AppResult<()> {
    crate::aws::auth::wipe_account_secrets(app, account_id)
}

pub fn save_credentials(app: &AppHandle, credentials: &AwsCredentialsInput) -> AppResult<()> {
    write_secret(app, KEYRING_USER, &credentials.access_key_id)?;
    write_secret(app, KEYRING_SECRET, &credentials.secret_access_key)?;
    write_optional_secret(
        app,
        KEYRING_SESSION_TOKEN,
        credentials.session_token.as_deref(),
    )?;
    Ok(())
}

pub fn clear_credentials(app: &AppHandle) -> AppResult<()> {
    for user in [KEYRING_USER, KEYRING_SECRET, KEYRING_SESSION_TOKEN] {
        delete_secret(app, user)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::credential_key;

    #[test]
    fn credential_key_is_scoped_by_account_id() {
        assert_eq!(
            credential_key("acct-prod", "secret_key"),
            "acct-prod/secret_key"
        );
    }
}
