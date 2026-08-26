use crate::diagnostics;
use crate::error::AppResult;

#[tauri::command]
pub fn get_app_log_path() -> AppResult<String> {
    Ok(diagnostics::app_log_path()?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_app_log() -> AppResult<()> {
    diagnostics::open_app_log()
}

#[tauri::command]
pub fn get_mcp_audit_dir() -> AppResult<String> {
    Ok(diagnostics::mcp_audit_dir()?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_mcp_audit_log() -> AppResult<()> {
    diagnostics::open_mcp_audit_log()
}
