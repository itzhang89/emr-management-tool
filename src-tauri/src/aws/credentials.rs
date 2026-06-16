use crate::error::{AppError, AppResult};
use crate::models::{AwsAccount, AwsCredentialsInput};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_types::region::Region;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(not(debug_assertions))]
const KEYCHAIN_SERVICE_NAME: &str = "emr-management-tool";
const KEYRING_USER: &str = "default/access_key";
const KEYRING_SECRET: &str = "default/secret_key";
const KEYRING_SESSION_TOKEN: &str = "default/session_token";
const DEV_CREDENTIAL_STORE_PATH: &str = "emr-management-tool.credentials.dev.json";

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
    let credentials = read_account_credentials(app, &account.id)?;
    Ok(aws_config_from_credentials(&AwsCredentialsInput {
        access_key_id: credentials.access_key_id,
        secret_access_key: credentials.secret_access_key,
        session_token: credentials.session_token,
        region: account.region.clone(),
    })
    .await)
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
    write_optional_secret(
        app,
        &credential_key(account_id, "session_token"),
        session_token,
    )?;
    Ok(())
}

pub fn read_account_credentials(
    app: &AppHandle,
    account_id: &str,
) -> AppResult<StoredAwsCredentials> {
    Ok(StoredAwsCredentials {
        access_key_id: read_secret(app, &credential_key(account_id, "access_key"))?,
        secret_access_key: read_secret(app, &credential_key(account_id, "secret_key"))?,
        session_token: read_optional_secret(app, &credential_key(account_id, "session_token"))?,
    })
}

pub fn clear_account_credentials(app: &AppHandle, account_id: &str) -> AppResult<()> {
    for secret_name in ["access_key", "secret_key", "session_token"] {
        delete_secret(app, &credential_key(account_id, secret_name))?;
    }
    Ok(())
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

fn write_optional_secret(app: &AppHandle, key: &str, value: Option<&str>) -> AppResult<()> {
    match value.filter(|value| !value.trim().is_empty()) {
        Some(value) => write_secret(app, key, value),
        None => delete_secret(app, key),
    }
}

fn write_secret(app: &AppHandle, key: &str, value: &str) -> AppResult<()> {
    if !use_local_credential_store() {
        return write_keychain_secret(key, value);
    }
    write_store_secret(app, key, value)
}

fn write_store_secret(app: &AppHandle, key: &str, value: &str) -> AppResult<()> {
    use serde_json::json;
    use tauri_plugin_store::StoreExt;

    let store = app
        .store(DEV_CREDENTIAL_STORE_PATH)
        .map_err(|error| AppError::storage(error.to_string()))?;
    store.set(key, json!(value));
    store
        .save()
        .map_err(|error| AppError::storage(error.to_string()))
}

#[cfg(not(debug_assertions))]
fn write_keychain_secret(key: &str, value: &str) -> AppResult<()> {
    keyring::use_native_store(false).map_err(|error| AppError::storage(error.to_string()))?;
    keyring_core::Entry::new(KEYCHAIN_SERVICE_NAME, key)
        .map_err(|error| AppError::storage(error.to_string()))?
        .set_password(value)
        .map_err(|error| AppError::storage(error.to_string()))
}

#[cfg(debug_assertions)]
fn write_keychain_secret(_key: &str, _value: &str) -> AppResult<()> {
    unreachable!("debug builds always use the local credential store")
}

fn read_secret(app: &AppHandle, key: &str) -> AppResult<String> {
    read_optional_secret(app, key)?.ok_or_else(|| {
        let backend = if use_local_credential_store() {
            "local store"
        } else {
            "keychain"
        };
        AppError::storage(format!("Credential {key} was not found in {backend}."))
    })
}

fn read_optional_secret(app: &AppHandle, key: &str) -> AppResult<Option<String>> {
    if !use_local_credential_store() {
        return read_optional_keychain_secret(key);
    }
    read_optional_store_secret(app, key)
}

fn read_optional_store_secret(app: &AppHandle, key: &str) -> AppResult<Option<String>> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store(DEV_CREDENTIAL_STORE_PATH)
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(store
        .get(key)
        .and_then(|value| value.as_str().map(ToString::to_string))
        .filter(|value| !value.trim().is_empty()))
}

#[cfg(not(debug_assertions))]
fn read_optional_keychain_secret(key: &str) -> AppResult<Option<String>> {
    keyring::use_native_store(false).map_err(|error| AppError::storage(error.to_string()))?;
    match keyring_core::Entry::new(KEYCHAIN_SERVICE_NAME, key)
        .map_err(|error| AppError::storage(error.to_string()))?
        .get_password()
    {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

#[cfg(debug_assertions)]
fn read_optional_keychain_secret(_key: &str) -> AppResult<Option<String>> {
    unreachable!("debug builds always use the local credential store")
}

fn delete_secret(app: &AppHandle, key: &str) -> AppResult<()> {
    if !use_local_credential_store() {
        return delete_keychain_secret(key);
    }
    delete_store_secret(app, key)
}

fn delete_store_secret(app: &AppHandle, key: &str) -> AppResult<()> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store(DEV_CREDENTIAL_STORE_PATH)
        .map_err(|error| AppError::storage(error.to_string()))?;
    store.delete(key);
    store
        .save()
        .map_err(|error| AppError::storage(error.to_string()))
}

#[cfg(not(debug_assertions))]
fn delete_keychain_secret(key: &str) -> AppResult<()> {
    keyring::use_native_store(false).map_err(|error| AppError::storage(error.to_string()))?;
    let entry = keyring_core::Entry::new(KEYCHAIN_SERVICE_NAME, key)
        .map_err(|error| AppError::storage(error.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = error.to_string();
            if message.to_lowercase().contains("not found") {
                Ok(())
            } else {
                Err(AppError::storage(message))
            }
        }
    }
}

#[cfg(debug_assertions)]
fn delete_keychain_secret(_key: &str) -> AppResult<()> {
    unreachable!("debug builds always use the local credential store")
}

fn use_local_credential_store() -> bool {
    should_use_local_credential_store(cfg!(debug_assertions), option_env!("EMR_APP_CHANNEL"))
}

fn should_use_local_credential_store(debug_assertions: bool, channel: Option<&str>) -> bool {
    debug_assertions || matches!(channel, Some("test" | "mac-debug"))
}

#[cfg(test)]
mod tests {
    use super::{credential_key, should_use_local_credential_store};

    #[test]
    fn credential_key_is_scoped_by_account_id() {
        assert_eq!(
            credential_key("acct-prod", "secret_key"),
            "acct-prod/secret_key"
        );
    }

    #[test]
    fn test_and_mac_debug_release_channels_use_local_credential_store() {
        assert!(should_use_local_credential_store(false, Some("test")));
        assert!(should_use_local_credential_store(false, Some("mac-debug")));
        assert!(!should_use_local_credential_store(false, Some("stable")));
        assert!(should_use_local_credential_store(true, Some("stable")));
    }
}
