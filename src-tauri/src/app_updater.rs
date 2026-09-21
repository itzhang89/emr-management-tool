//! Installer-channel update checks on a runtime-selectable channel.
//!
//! The Tauri updater plugin resolves its endpoints from `tauri.conf.json` at
//! build time, and neither its JS `check()` nor the command behind it accepts
//! endpoints (`CheckOptions` is headers/timeout/proxy/target/allowDowngrades).
//! Overriding them is Rust-only, via `UpdaterBuilder::endpoints`, so the
//! installer path goes through the commands here instead of the plugin's JS API
//! — the same shape `portable_updater` already uses for portable builds.
//!
//! Stable keeps the configured endpoints (including their fallback); beta points
//! at its own rolling manifest. Only one channel is consulted per check: the
//! plugin takes the first endpoint that parses and does not fall through when it
//! simply reports no newer version.

use crate::error::{AppError, AppResult};
use crate::update_channel::{build_can_update, UpdateChannel};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, Url};
use tauri_plugin_updater::UpdaterExt;

/// What the UI needs to describe an available update. Mirrors
/// `PortableUpdateInfo` minus the download details, which stay in Rust.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
}

fn build_updater<R: Runtime>(
    app: &AppHandle<R>,
    channel: UpdateChannel,
) -> AppResult<tauri_plugin_updater::Updater> {
    // Endpoints always come from here rather than `tauri.conf.json`: the URLs
    // are composed from the build-time repository slug, so no repository address
    // lives in a config file.
    let endpoints = channel
        .installer_manifests()
        .into_iter()
        .map(|manifest| {
            Url::parse(&manifest).map_err(|error| {
                AppError::internal(format!("Invalid update endpoint {manifest}: {error}"))
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    app.updater_builder()
        .endpoints(endpoints)
        .map_err(|error| AppError::internal(format!("Failed to configure the updater: {error}")))?
        .build()
        .map_err(|error| AppError::internal(format!("Failed to build the updater: {error}")))
}

pub async fn check_update<R: Runtime>(
    app: &AppHandle<R>,
    channel: UpdateChannel,
) -> AppResult<Option<AppUpdateInfo>> {
    if !build_can_update() {
        return Ok(None);
    }

    let updater = build_updater(app, channel)?;
    let update = updater.check().await.map_err(|error| {
        AppError::internal(format!(
            "Update check on the {} channel failed: {error}",
            channel.as_str()
        ))
    })?;

    Ok(update.map(|update| AppUpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
    }))
}

pub async fn install_update<R: Runtime>(
    app: &AppHandle<R>,
    channel: UpdateChannel,
) -> AppResult<()> {
    if !build_can_update() {
        return Err(AppError::validation(
            "This build cannot update itself. Download a new package from the release page.",
        ));
    }

    // Re-check rather than trusting a version from the WebView: the update is
    // installed from whatever the channel advertises now.
    let updater = build_updater(app, channel)?;
    let Some(update) = updater.check().await.map_err(|error| {
        AppError::internal(format!(
            "Update check on the {} channel failed: {error}",
            channel.as_str()
        ))
    })?
    else {
        return Err(AppError::validation(
            "No update is available on this channel any more.",
        ));
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| AppError::internal(format!("Failed to install the update: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_info_serializes_for_the_webview() {
        let info = AppUpdateInfo {
            version: "0.2.2-beta1".into(),
            current_version: "0.2.1".into(),
            notes: Some("Beta 1".into()),
        };
        let json = serde_json::to_value(&info).expect("serialize");
        assert_eq!(json["version"], "0.2.2-beta1");
        assert_eq!(json["currentVersion"], "0.2.1");
        assert_eq!(json["notes"], "Beta 1");
    }

    #[test]
    fn update_info_round_trips_without_notes() {
        let json = serde_json::json!({
            "version": "0.2.2-beta2",
            "currentVersion": "0.2.2-beta1",
            "notes": null
        });
        let info: AppUpdateInfo = serde_json::from_value(json).expect("deserialize");
        assert_eq!(info.notes, None);
    }
}
