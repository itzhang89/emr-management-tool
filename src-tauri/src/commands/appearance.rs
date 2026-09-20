use serde::Deserialize;
use tauri::AppHandle;

use crate::error::AppResult;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAppLanguageRequest {
    /// A BCP-47 tag (`"zh-CN"`, `"en-US"`) or a bare code (`"zh"`, `"en"`).
    pub language: String,
}

/// Rebuilds the native menu in the given language.
///
/// The frontend owns the language preference — it is stored in `localStorage`,
/// which Rust cannot read — so the resolved tag is pushed on boot and again on
/// every change.
#[tauri::command]
pub fn set_app_language(app: AppHandle, request: SetAppLanguageRequest) -> AppResult<()> {
    #[cfg(desktop)]
    {
        let language = crate::menu::AppLanguage::from_code(&request.language);
        let menu = crate::menu::build_menu(&app, language)
            .map_err(|error| crate::error::AppError::internal(format!("Failed to build the app menu: {error}")))?;
        app.set_menu(menu)
            .map_err(|error| crate::error::AppError::internal(format!("Failed to apply the app menu: {error}")))?;
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, request);
    }
    Ok(())
}
