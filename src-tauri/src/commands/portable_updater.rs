use tauri::{command, AppHandle};
use crate::error::AppError;
use crate::portable_updater::{check_portable_update as check_update, install_portable_update as install_update, PortableUpdateInfo};

#[command]
pub async fn check_portable_update() -> Result<Option<PortableUpdateInfo>, AppError> {
    check_update().await
}

#[command]
pub async fn install_portable_update(
    app: AppHandle,
    request: PortableUpdateInfo,
) -> Result<(), AppError> {
    install_update(&app, &request).await
}
