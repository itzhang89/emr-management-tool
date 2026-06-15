use std::backtrace::Backtrace;
use std::panic;
use std::sync::Once;

static INSTALL_PANIC_HOOK: Once = Once::new();

pub fn install_panic_hook() {
    INSTALL_PANIC_HOOK.call_once(|| {
        panic::set_hook(Box::new(|info| {
            let payload = panic_payload(info.payload());
            let location = info
                .location()
                .map(|location| (location.file(), location.line(), location.column()));
            let backtrace = Backtrace::force_capture().to_string();

            eprintln!("{}", format_panic_report(&payload, location, &backtrace));
        }));
    });
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
