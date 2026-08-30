pub mod chat;
pub mod llm;
pub mod repository;

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

pub fn app_data_dir() -> AppResult<PathBuf> {
    resolve_app_data_dir_with_base(
        crate::distribution::is_portable(),
        std::env::current_exe().ok().as_deref(),
        dirs::data_dir(),
    )
}

pub fn resolve_app_data_dir(is_portable: bool, exe_path: Option<&Path>) -> AppResult<PathBuf> {
    resolve_app_data_dir_with_base(is_portable, exe_path, dirs::data_dir())
}

pub fn resolve_app_data_dir_with_base(
    is_portable: bool,
    exe_path: Option<&Path>,
    system_data_dir: Option<PathBuf>,
) -> AppResult<PathBuf> {
    if is_portable {
        let exe = exe_path
            .ok_or_else(|| AppError::storage("Unable to locate the application executable."))?;
        let parent = exe
            .parent()
            .ok_or_else(|| AppError::storage("Unable to locate the application directory."))?;
        return Ok(parent.join("data"));
    }
    system_data_dir
        .map(|dir| dir.join("emr-management-tool"))
        .ok_or_else(|| AppError::storage("Unable to locate an application data directory."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn portable_data_dir_is_beside_exe() {
        let exe = PathBuf::from("C:/tools/emr/app.exe");
        let dir = resolve_app_data_dir(true, Some(&exe)).unwrap();
        assert_eq!(dir, PathBuf::from("C:/tools/emr/data"));
    }

    #[test]
    fn installer_data_dir_uses_system_data() {
        let base = PathBuf::from("/var/app-data");
        let dir = resolve_app_data_dir_with_base(false, None, Some(base)).unwrap();
        assert_eq!(dir, PathBuf::from("/var/app-data/emr-management-tool"));
    }
}
