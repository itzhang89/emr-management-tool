//! Secret storage shared by AWS credentials and LLM provider API keys.
//!
//! Two backends, chosen by build configuration: the OS keychain for release
//! builds, and a tauri-plugin-store JSON file for debug and portable builds
//! (which have no keychain entitlement to rely on). Callers never see which one
//! is in use — they get a flat key/value API and the rule that a secret written
//! here never reaches the WebView.

use crate::error::{AppError, AppResult};
use std::path::PathBuf;
#[cfg(not(debug_assertions))]
use std::sync::OnceLock;
use tauri::AppHandle;

#[cfg(not(debug_assertions))]
const KEYCHAIN_SERVICE_NAME: &str = "emr-management-tool";
const CREDENTIAL_STORE_FILENAME: &str = "emr-management-tool.credentials.json";
/// Store file used before credentials moved into `app_data_dir()`. Kept so
/// existing installs do not lose their saved accounts.
const LEGACY_CREDENTIAL_STORE_FILENAME: &str = "emr-management-tool.credentials.dev.json";

/// Writes a secret, or deletes the entry when the value is absent or blank.
pub fn write_optional_secret(app: &AppHandle, key: &str, value: Option<&str>) -> AppResult<()> {
    match value.filter(|value| !value.trim().is_empty()) {
        Some(value) => write_secret(app, key, value),
        None => delete_secret(app, key),
    }
}

pub fn write_secret(app: &AppHandle, key: &str, value: &str) -> AppResult<()> {
    if !use_local_credential_store() {
        return write_keychain_secret(key, value);
    }
    write_store_secret(app, key, value)
}

pub fn read_secret(app: &AppHandle, key: &str) -> AppResult<String> {
    read_optional_secret(app, key)?.ok_or_else(|| {
        let backend = if use_local_credential_store() {
            "local store"
        } else {
            "keychain"
        };
        AppError::storage(format!("Credential {key} was not found in {backend}."))
    })
}

pub fn read_optional_secret(app: &AppHandle, key: &str) -> AppResult<Option<String>> {
    if !use_local_credential_store() {
        return read_optional_keychain_secret(key);
    }
    read_optional_store_secret(app, key)
}

pub fn delete_secret(app: &AppHandle, key: &str) -> AppResult<()> {
    if !use_local_credential_store() {
        return delete_keychain_secret(key);
    }
    delete_store_secret(app, key)
}

fn credential_store_path(_app: &AppHandle) -> AppResult<PathBuf> {
    Ok(crate::db::app_data_dir()?.join(CREDENTIAL_STORE_FILENAME))
}

/// The legacy store was addressed by a bare filename, which tauri-plugin-store
/// resolved against the app config dir rather than `app_data_dir()`.
fn legacy_credential_store_path(app: &AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(LEGACY_CREDENTIAL_STORE_FILENAME))
}

/// Copies secrets written by builds that predate the `app_data_dir()` store
/// location. Without this, existing accounts still resolve from SQLite but
/// their credentials read back as missing.
pub fn migrate_legacy_credential_store(app: &AppHandle) -> AppResult<()> {
    use tauri_plugin_store::StoreExt;

    if !use_local_credential_store() {
        return Ok(());
    }

    let Some(legacy_path) = legacy_credential_store_path(app) else {
        return Ok(());
    };
    if !legacy_path.exists() {
        return Ok(());
    }

    let raw = std::fs::read_to_string(&legacy_path)
        .map_err(|error| AppError::storage(error.to_string()))?;
    let legacy: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&raw).map_err(|error| AppError::storage(error.to_string()))?;
    if legacy.is_empty() {
        return Ok(());
    }

    let data_dir = crate::db::app_data_dir()?;
    std::fs::create_dir_all(&data_dir).map_err(|error| AppError::storage(error.to_string()))?;
    let path = credential_store_path(app)?;
    let store = app
        .store(&path)
        .map_err(|error| AppError::storage(error.to_string()))?;

    let mut migrated = 0usize;
    for (key, value) in legacy {
        if store.get(&key).is_some() {
            continue;
        }
        if value.as_str().is_none_or(|value| value.trim().is_empty()) {
            continue;
        }
        store.set(key, value);
        migrated += 1;
    }

    if migrated == 0 {
        return Ok(());
    }

    store
        .save()
        .map_err(|error| AppError::storage(error.to_string()))?;
    crate::diagnostics::append_log_line(
        "INFO",
        &format!("Migrated {migrated} credential entries from the legacy store."),
    );
    Ok(())
}

// --- Local JSON store backend --------------------------------------------

fn write_store_secret(app: &AppHandle, key: &str, value: &str) -> AppResult<()> {
    use serde_json::json;
    use tauri_plugin_store::StoreExt;

    let data_dir = crate::db::app_data_dir()?;
    std::fs::create_dir_all(&data_dir).map_err(|error| AppError::storage(error.to_string()))?;
    let path = credential_store_path(app)?;
    let store = app
        .store(&path)
        .map_err(|error| AppError::storage(error.to_string()))?;
    store.set(key, json!(value));
    store
        .save()
        .map_err(|error| AppError::storage(error.to_string()))
}

fn read_optional_store_secret(app: &AppHandle, key: &str) -> AppResult<Option<String>> {
    use tauri_plugin_store::StoreExt;

    let path = credential_store_path(app)?;
    let store = app
        .store(&path)
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(store
        .get(key)
        .and_then(|value| value.as_str().map(ToString::to_string))
        .filter(|value| !value.trim().is_empty()))
}

fn delete_store_secret(app: &AppHandle, key: &str) -> AppResult<()> {
    use tauri_plugin_store::StoreExt;

    let path = credential_store_path(app)?;
    let store = app
        .store(&path)
        .map_err(|error| AppError::storage(error.to_string()))?;
    store.delete(key);
    store
        .save()
        .map_err(|error| AppError::storage(error.to_string()))
}

// --- OS keychain backend --------------------------------------------------

#[cfg(not(debug_assertions))]
fn ensure_default_keyring_store() -> AppResult<()> {
    static INIT: OnceLock<Result<(), AppError>> = OnceLock::new();

    INIT.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            let store = apple_native_keyring_store::keychain::Store::new()
                .map_err(|error| AppError::storage(error.to_string()))?;
            keyring_core::set_default_store(store);
        }

        #[cfg(target_os = "windows")]
        {
            let store = windows_native_keyring_store::Store::new()
                .map_err(|error| AppError::storage(error.to_string()))?;
            keyring_core::set_default_store(store);
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            return Err(AppError::storage(
                "Native credential store is not supported on this platform.".to_string(),
            ));
        }

        Ok(())
    })
    .clone()
}

#[cfg(not(debug_assertions))]
fn write_keychain_secret(key: &str, value: &str) -> AppResult<()> {
    ensure_default_keyring_store()?;
    keyring_core::Entry::new(KEYCHAIN_SERVICE_NAME, key)
        .map_err(|error| AppError::storage(error.to_string()))?
        .set_password(value)
        .map_err(|error| AppError::storage(error.to_string()))
}

#[cfg(debug_assertions)]
fn write_keychain_secret(_key: &str, _value: &str) -> AppResult<()> {
    unreachable!("debug builds always use the local credential store")
}

#[cfg(not(debug_assertions))]
fn read_optional_keychain_secret(key: &str) -> AppResult<Option<String>> {
    ensure_default_keyring_store()?;
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

#[cfg(not(debug_assertions))]
fn delete_keychain_secret(key: &str) -> AppResult<()> {
    ensure_default_keyring_store()?;
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

// --- Backend selection ----------------------------------------------------

fn use_local_credential_store() -> bool {
    should_use_local_credential_store(
        cfg!(debug_assertions),
        option_env!("EMR_APP_CHANNEL"),
        option_env!("EMR_CREDENTIAL_STORE"),
        option_env!("EMR_APP_DISTRIBUTION"),
    )
}

fn should_use_local_credential_store(
    debug_assertions: bool,
    channel: Option<&str>,
    credential_store: Option<&str>,
    distribution: Option<&str>,
) -> bool {
    if matches!(distribution, Some("portable")) {
        return true;
    }
    match credential_store {
        Some("local") => true,
        Some("keychain") => false,
        _ => debug_assertions || matches!(channel, Some("development")),
    }
}

#[cfg(test)]
mod tests {
    use super::should_use_local_credential_store;

    #[test]
    fn development_release_channels_use_local_credential_store() {
        assert!(should_use_local_credential_store(
            false,
            Some("development"),
            None,
            None,
        ));
        assert!(!should_use_local_credential_store(
            false,
            Some("stable"),
            None,
            None,
        ));
        assert!(should_use_local_credential_store(
            true,
            Some("stable"),
            None,
            None,
        ));
    }

    #[test]
    fn credential_store_build_variable_overrides_default_backend() {
        assert!(should_use_local_credential_store(
            false,
            Some("stable"),
            Some("local"),
            None,
        ));
        assert!(!should_use_local_credential_store(
            true,
            Some("development"),
            Some("keychain"),
            None,
        ));
        assert!(!should_use_local_credential_store(
            false,
            Some("stable"),
            Some("auto"),
            None,
        ));
        assert!(should_use_local_credential_store(
            true,
            Some("stable"),
            Some("unexpected"),
            None,
        ));
    }

    #[test]
    fn portable_distribution_forces_local_credential_store() {
        assert!(should_use_local_credential_store(
            false,
            Some("stable"),
            Some("keychain"),
            Some("portable"),
        ));
        assert!(!should_use_local_credential_store(
            false,
            Some("stable"),
            None,
            Some("installer"),
        ));
    }
}
