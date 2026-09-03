//! Shared fire-and-forget audit writer for MCP tool invocations.
//!
//! Both places a tool can be invoked write to the same `mcp_audit` table through
//! this one helper:
//!
//! * the `McpTools` server handler (external HTTP agents), and
//! * the Chat loop in `session.rs` (in-process calls made by the assistant).
//!
//! The Chat loop is the only caller that knows *which* model drove a call, so it
//! passes `provider_id`/`model_id`; rows from external agents leave them `None`.
//! A failed audit write can never break the tool call — the write is spawned and
//! only ever logged.

use crate::models::McpAuditEntry;

/// Write one audit row, fire-and-forget. Callers never await it.
pub fn record(
    tool: &str,
    client: Option<&str>,
    args: serde_json::Value,
    result: serde_json::Value,
    error: Option<String>,
    duration_ms: i64,
    provider_id: Option<String>,
    model_id: Option<String>,
) {
    // Tool results can embed raw log tails (an analyze tool's evidence). They
    // are too large and too noisy to keep per-invocation, so any `rawLogs`
    // object dropped wherever it sits — for every tool and every transport.
    let mut result = result;
    without_raw_logs(&mut result);
    let started_at = chrono::Utc::now();
    let tool = tool.to_string();
    let client = client.map(ToString::to_string);
    tauri::async_runtime::spawn(async move {
        let pool = match crate::db::repository::pool().await {
            Ok(pool) => pool,
            Err(error) => {
                crate::diagnostics::append_log_line(
                    "WARN",
                    &format!("mcp audit: failed to open database: {error}"),
                );
                return;
            }
        };
        let entry = McpAuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: started_at.to_rfc3339(),
            status: if error.is_some() { "error" } else { "success" }.to_string(),
            tool,
            client,
            duration_ms,
            args,
            result,
            error,
            provider_id,
            model_id,
        };
        if let Err(error) = crate::db::repository::insert_mcp_audit_entry(&pool, &entry).await {
            crate::diagnostics::append_log_line(
                "WARN",
                &format!("mcp audit: failed to write entry: {error}"),
            );
        }
    });
}

/// Remove every `rawLogs` key from a JSON tree — the audit row keeps the
/// structured evidence, not the raw log bodies behind it.
fn without_raw_logs(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.remove("rawLogs");
            for child in map.values_mut() {
                without_raw_logs(child);
            }
        }
        serde_json::Value::Array(items) => {
            for child in items {
                without_raw_logs(child);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::without_raw_logs;
    use serde_json::json;

    #[test]
    fn strips_raw_logs_at_any_depth_but_keeps_structure() {
        let mut value = json!({
            "jobId": "0000000381t77o3g8f5",
            "evidence": { "kind": "oom", "rawLogs": ["line one", "line two"] },
            "controllerEvidence": { "rawLogs": "controller tail" },
            "nested": { "deep": { "rawLogs": [1, 2] }, "kept": true },
        });

        without_raw_logs(&mut value);

        assert!(value["evidence"].get("rawLogs").is_none());
        assert!(value["controllerEvidence"].get("rawLogs").is_none());
        assert!(value["nested"]["deep"].get("rawLogs").is_none());
        // Everything else survives.
        assert_eq!(value["jobId"], "0000000381t77o3g8f5");
        assert_eq!(value["evidence"]["kind"], "oom");
        assert_eq!(value["nested"]["kept"], true);
    }

    #[test]
    fn leaves_values_without_raw_logs_untouched() {
        let mut value = json!({ "accounts": [{ "name": "prod", "active": true }] });
        without_raw_logs(&mut value);
        assert_eq!(value["accounts"][0]["name"], "prod");
    }
}
