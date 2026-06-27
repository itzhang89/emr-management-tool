use crate::error::{AppError, AppResult};
use chrono::Utc;
use std::backtrace::Backtrace;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::panic;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex, Once};

static INSTALL_PANIC_HOOK: Once = Once::new();
static LOG_FILE: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

pub fn install_panic_hook() {
    INSTALL_PANIC_HOOK.call_once(|| {
        panic::set_hook(Box::new(|info| {
            let payload = panic_payload(info.payload());
            let location = info
                .location()
                .map(|location| (location.file(), location.line(), location.column()));
            let backtrace = Backtrace::force_capture().to_string();
            let report = format_panic_report(&payload, location, &backtrace);
            eprintln!("{report}");
            append_log_line("ERROR", &report);
        }));
    });
}

pub fn init_file_logger() -> AppResult<()> {
    let path = app_log_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::storage(error.to_string()))?;
    }
    if !path.exists() {
        fs::write(
            &path,
            format!(
                "EMR Management Tool log started at {}\n",
                Utc::now().to_rfc3339()
            ),
        )
        .map_err(|error| AppError::storage(error.to_string()))?;
    }
    if let Ok(mut guard) = LOG_FILE.lock() {
        *guard = Some(path);
    }
    append_log_line("INFO", "Application started.");
    Ok(())
}

pub fn app_log_path() -> AppResult<PathBuf> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| AppError::storage("Could not resolve the local app data directory."))?;
    Ok(base
        .join("emr-management-tool")
        .join("logs")
        .join("app.log"))
}

pub fn append_log_line(level: &str, message: &str) {
    let path = LOG_FILE
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .or_else(|| app_log_path().ok());
    let Some(path) = path else {
        return;
    };

    let line = format!("{} [{}] {}\n", Utc::now().to_rfc3339(), level, message);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

pub fn log_aws_failure(service: &str, operation: &str, account_id: Option<&str>, message: &str) {
    let account = account_id.unwrap_or("unknown");
    append_log_line(
        "ERROR",
        &format!("AWS {service}.{operation} failed for account {account}: {message}"),
    );
}

pub fn open_app_log() -> AppResult<()> {
    let path = app_log_path()?;
    if !path.exists() {
        init_file_logger()?;
    }
    open_path_in_system(&path)
}

fn open_path_in_system(path: &Path) -> AppResult<()> {
    append_log_line("INFO", &format!("Opening log file at {}", path.display()));
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(path).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .status()
    } else {
        Command::new("xdg-open").arg(path).status()
    };

    result
        .map_err(|error| AppError::internal(format!("Failed to open log file: {error}")))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(AppError::internal(format!(
                    "System command to open {} exited with {}",
                    path.display(),
                    status
                )))
            }
        })
}

fn format_panic_report(
    payload: &str,
    location: Option<(&str, u32, u32)>,
    backtrace: &str,
) -> String {
    let location = location
        .map(|(file, line, column)| format!("{file}:{line}:{column}"))
        .unwrap_or_else(|| "unknown".to_string());

    format!("panic captured: {payload}\nlocation: {location}\nbacktrace:\n{backtrace}")
}

fn panic_payload(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }

    "<non-string panic payload>".to_string()
}

#[cfg(test)]
mod tests {
    use super::format_panic_report;

    #[test]
    fn formats_panic_report_with_location_and_backtrace() {
        let report = format_panic_report(
            "boom",
            Some(("src/lib.rs", 42, 9)),
            "stack frame 1\nstack frame 2",
        );

        assert!(report.contains("panic captured: boom"));
        assert!(report.contains("location: src/lib.rs:42:9"));
        assert!(report.contains("backtrace:\nstack frame 1\nstack frame 2"));
    }
}
