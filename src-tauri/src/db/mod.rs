pub mod repository;

use crate::error::{AppError, AppResult};
use std::path::PathBuf;

pub fn app_data_dir() -> AppResult<PathBuf> {
    dirs::data_dir()
        .map(|dir| dir.join("emr-management-tool"))
        .ok_or_else(|| AppError::Storage("Unable to locate an application data directory.".to_string()))
}
