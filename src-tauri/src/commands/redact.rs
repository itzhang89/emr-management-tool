//! Read/write the configurable log desensitization rules and run a batch test
//! over the Redaction tab's local rules.
//!
//! Saving is "commit the whole set": the tab edits a working copy and posts it
//! back in full. Save reloads the process-global rule cache so the *next* MCP
//! tool call redacts with the new set; a separate startup load (see
//! [`prime`]) makes persisted rules live again on the next launch.

use crate::db::{redact as redact_db, repository};
use crate::error::{AppError, AppResult};
use crate::mcp::sanitize;
use crate::models::{
    RedactConfig, RedactRule, RedactRuleKind, RedactSaveRequest, RedactTestRequest,
    RedactTestResult,
};

/// Load the persisted rules into the process-global engine right after the DB
/// exists. Spawned from setup (which cannot await); until it finishes the engine
/// runs on its defaults, identical to current behaviour.
pub fn prime() {
    tauri::async_runtime::spawn(async {
        let result = load_rules_from_db().await;
        if let Err(error) = result {
            diagnostics_for_failure(&error);
        }
    });
}

/// Best-effort log of a load failure (e.g. an unreadable DB) without crashing
/// launch — redaction silently falls back to defaults.
fn diagnostics_for_failure(error: &AppError) {
    crate::diagnostics::append_log_line("WARN", &format!("Failed to load redaction rules: {error}"));
}

async fn load_rules_from_db() -> AppResult<Vec<RedactRule>> {
    let pool = repository::pool().await?;
    let rules = redact_db::list_rules(&pool).await?;
    sanitize::load_rules(&rules);
    Ok(rules)
}

#[tauri::command]
pub async fn redact_get_config() -> AppResult<RedactConfig> {
    let pool = repository::pool().await?;
    let rules = redact_db::list_rules(&pool).await?;
    Ok(RedactConfig { rules })
}

// Assign a stable id to a local-only custom rule so it can be referenced and
// replaced on later saves.
fn ensure_custom_ids(rules: Vec<RedactRule>) -> Vec<RedactRule> {
    rules
        .into_iter()
        .map(|rule| {
            if rule.kind == RedactRuleKind::Custom && rule.id.trim().is_empty() {
                RedactRule { id: uuid::Uuid::new_v4().to_string(), ..rule }
            } else {
                rule
            }
        })
        .collect()
}

#[tauri::command]
pub async fn redact_save_config(request: RedactSaveRequest) -> AppResult<RedactConfig> {
    for rule in &request.rules {
        if rule.kind == RedactRuleKind::Custom {
            let pattern = rule.pattern.as_deref().unwrap_or_default().trim();
            if pattern.is_empty() {
                return Err(AppError::validation(
                    format!("Rule \"{}\" has no pattern to match on.", rule.name),
                ));
            }
        }
    }

    let rules = ensure_custom_ids(request.rules);
    let pool = repository::pool().await?;
    redact_db::save_rules(&pool, &rules).await?;

    // Read back the authoritative set and push it into the process-global
    // engine so the next tool call uses it (no TOCTOU against what we saved).
    load_rules_from_db().await?;
    let rules = redact_db::list_rules(&pool).await?;
    Ok(RedactConfig { rules })
}

#[tauri::command]
pub async fn redact_reset_defaults() -> AppResult<RedactConfig> {
    let pool = repository::pool().await?;
    redact_db::reset_to_defaults(&pool).await?;
    let rules = load_rules_from_db().await?;
    Ok(RedactConfig { rules })
}

#[tauri::command]
pub async fn redact_test(request: RedactTestRequest) -> AppResult<RedactTestResult> {
    let outcome = sanitize::sanitize_with_rules(&request.text, &request.rules);
    Ok(RedactTestResult {
        masked: outcome.text,
        count: outcome.count as u64,
        // De-duplicated, order-preserving list of which rules actually masked
        // something, matching how the reference UI names its hits.
        hits: unique_in_order(outcome.hits),
    })
}

fn unique_in_order(names: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    names.into_iter().filter(|name| seen.insert(name.clone())).collect()
}
