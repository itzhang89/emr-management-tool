//! Update commands. Both paths take the channel the user opted into; the Rust
//! side decides which manifest that means (see `update_channel`).

use crate::app_updater::{check_update as check_app, install_update as install_app, AppUpdateInfo};
use crate::error::AppError;
use crate::portable_updater::{
    check_portable_update as check_portable, install_portable_update as install_portable,
    PortableUpdateInfo,
};
use crate::update_channel::UpdateChannel;
use serde::Deserialize;
use tauri::{command, AppHandle};

/// The frontend reaches every command through a wrapper that nests the payload
/// under `request`, so commands taking arguments must declare a request struct
/// rather than bare parameters.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChannelRequest {
    pub channel: String,
}

#[command]
pub async fn check_app_update(
    app: AppHandle,
    request: UpdateChannelRequest,
) -> Result<Option<AppUpdateInfo>, AppError> {
    check_app(&app, UpdateChannel::parse(&request.channel)?).await
}

#[command]
pub async fn install_app_update(
    app: AppHandle,
    request: UpdateChannelRequest,
) -> Result<(), AppError> {
    install_app(&app, UpdateChannel::parse(&request.channel)?).await
}

#[command]
pub async fn check_portable_update(
    request: UpdateChannelRequest,
) -> Result<Option<PortableUpdateInfo>, AppError> {
    check_portable(UpdateChannel::parse(&request.channel)?).await
}

#[command]
pub async fn install_portable_update(
    app: AppHandle,
    request: PortableUpdateInfo,
) -> Result<(), AppError> {
    install_portable(&app, &request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape the WebView sends: `invoke("check_app_update", { request: { channel } })`.
    #[test]
    fn channel_request_matches_the_client_payload() {
        let request: UpdateChannelRequest =
            serde_json::from_value(serde_json::json!({ "channel": "beta" })).expect("deserialize");
        assert_eq!(request.channel, "beta");
        assert_eq!(
            UpdateChannel::parse(&request.channel).expect("parse"),
            UpdateChannel::Beta
        );
    }

    #[test]
    fn channel_request_rejects_a_missing_channel() {
        assert!(serde_json::from_value::<UpdateChannelRequest>(serde_json::json!({})).is_err());
    }
}
