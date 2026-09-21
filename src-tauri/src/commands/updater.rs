//! Update commands. Both paths take the channel the user opted into; the Rust
//! side decides which manifest that means (see `update_channel`).

use crate::app_updater::{
    check_update as check_app, install_update as install_app, AppUpdateInfo,
};
use crate::error::AppError;
use crate::portable_updater::{
    check_portable_update as check_portable, install_portable_update as install_portable,
    PortableUpdateInfo,
};
use crate::update_channel::UpdateChannel;
use tauri::{command, AppHandle};

#[command]
pub async fn check_app_update(
    app: AppHandle,
    channel: String,
) -> Result<Option<AppUpdateInfo>, AppError> {
    check_app(&app, UpdateChannel::parse(&channel)?).await
}

#[command]
pub async fn install_app_update(app: AppHandle, channel: String) -> Result<(), AppError> {
    install_app(&app, UpdateChannel::parse(&channel)?).await
}

#[command]
pub async fn check_portable_update(
    channel: String,
) -> Result<Option<PortableUpdateInfo>, AppError> {
    check_portable(UpdateChannel::parse(&channel)?).await
}

#[command]
pub async fn install_portable_update(
    app: AppHandle,
    request: PortableUpdateInfo,
) -> Result<(), AppError> {
    install_portable(&app, &request).await
}
