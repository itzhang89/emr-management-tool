//! LLM provider configuration: the SQLite tree joined with keychain secrets.
//!
//! `db::llm` stores everything except API keys; `crate::secrets` stores the
//! keys. This module is where the two meet, and it is the only place that knows
//! an endpoint's key exists. What crosses to the WebView is a masked value the
//! frontend can replace but never read back — the same rule already enforced
//! for AWS secret access keys.

use crate::error::{AppError, AppResult};
use crate::models::{
    AddLlmModelInput, LlmEndpointTestResult, LlmModelCandidate, LlmProvider, LlmProviderKind,
};
use crate::secrets;
use sqlx::SqlitePool;
use std::time::Instant;
use tauri::AppHandle;

/// Keychain key for an endpoint's API key. Scoped by endpoint id, so two
/// endpoints of the same provider hold independent keys.
pub fn api_key_key(endpoint_id: &str) -> String {
    format!("llm/{endpoint_id}/api_key")
}

/// What the frontend sees instead of a key. Short keys collapse entirely rather
/// than revealing most of their characters.
pub fn mask_api_key(api_key: &str) -> String {
    let trimmed = api_key.trim();
    if trimmed.len() <= 8 {
        return "••••••••".to_string();
    }
    format!("{}••••{}", &trimmed[..3], &trimmed[trimmed.len() - 4..])
}

/// The whole provider tree, with each endpoint's key presence resolved from the
/// keychain. Never contains a key itself.
pub async fn list_providers(app: &AppHandle, pool: &SqlitePool) -> AppResult<Vec<LlmProvider>> {
    let mut providers = crate::db::llm::list_providers(pool).await?;
    for provider in &mut providers {
        for endpoint in &mut provider.endpoints {
            // A keychain read failing is not the same as "no key" in principle,
            // but for display purposes both mean "we cannot use this endpoint",
            // and surfacing a read error per row would be noise.
            let stored = secrets::read_optional_secret(app, &api_key_key(&endpoint.id))
                .unwrap_or(None);
            endpoint.api_key_masked = stored.as_deref().map(mask_api_key);
            endpoint.has_api_key = stored.is_some();
        }
    }
    Ok(providers)
}

// --- Providers -------------------------------------------------------------

pub async fn create_provider(
    pool: &SqlitePool,
    name: &str,
    kind: LlmProviderKind,
) -> AppResult<String> {
    crate::db::llm::create_provider(pool, name, kind).await
}

pub async fn update_provider(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    enabled: Option<bool>,
    sort_order: Option<i64>,
) -> AppResult<()> {
    crate::db::llm::update_provider(pool, id, name, enabled, sort_order).await
}

/// Deletes a provider along with its endpoints, models, and their API keys.
/// Keys go last: if the row deletion fails we have not yet destroyed anything
/// the user might still need.
pub async fn delete_provider(app: &AppHandle, pool: &SqlitePool, id: &str) -> AppResult<()> {
    let endpoint_ids = crate::db::llm::delete_provider(pool, id).await?;
    for endpoint_id in endpoint_ids {
        forget_api_key(app, &endpoint_id);
    }
    Ok(())
}

// --- Endpoints -------------------------------------------------------------

pub async fn create_endpoint(
    app: &AppHandle,
    pool: &SqlitePool,
    provider_id: &str,
    name: &str,
    base_url: &str,
    api_key: Option<&str>,
    is_default: bool,
) -> AppResult<String> {
    let id = crate::db::llm::create_endpoint(pool, provider_id, name, base_url, is_default).await?;
    if let Err(error) = secrets::write_optional_secret(app, &api_key_key(&id), api_key) {
        // Do not leave a keyless endpoint behind for a key the user did supply.
        let _ = crate::db::llm::delete_endpoint(pool, &id).await;
        return Err(error);
    }
    Ok(id)
}

/// `api_key: None` leaves the stored key untouched; `Some("")` clears it.
pub async fn update_endpoint(
    app: &AppHandle,
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    base_url: Option<&str>,
    api_key: Option<&str>,
    is_default: Option<bool>,
) -> AppResult<()> {
    crate::db::llm::update_endpoint(pool, id, name, base_url, is_default).await?;
    if let Some(api_key) = api_key {
        secrets::write_optional_secret(app, &api_key_key(id), Some(api_key))?;
    }
    Ok(())
}

pub async fn delete_endpoint(app: &AppHandle, pool: &SqlitePool, id: &str) -> AppResult<()> {
    crate::db::llm::delete_endpoint(pool, id).await?;
    forget_api_key(app, id);
    Ok(())
}

/// Best-effort key removal. A failure here must not abort the delete — the row
/// is already gone, and retrying is impossible without it.
fn forget_api_key(app: &AppHandle, endpoint_id: &str) {
    if let Err(error) = secrets::delete_secret(app, &api_key_key(endpoint_id)) {
        crate::diagnostics::append_log_line(
            "WARN",
            &format!("Failed to remove the stored API key for endpoint {endpoint_id}: {error}"),
        );
    }
}

/// The API key for an endpoint, for the chat loop and model sync. Never
/// returned through a Tauri command.
pub fn read_api_key(app: &AppHandle, endpoint_id: &str) -> AppResult<String> {
    secrets::read_optional_secret(app, &api_key_key(endpoint_id))?.ok_or_else(|| {
        AppError::validation("This endpoint has no API key configured. Add one before using it.")
    })
}

// --- Models ----------------------------------------------------------------

pub async fn add_models(
    pool: &SqlitePool,
    endpoint_id: &str,
    models: &[AddLlmModelInput],
) -> AppResult<usize> {
    crate::db::llm::add_models(pool, endpoint_id, models).await
}

pub async fn update_model(
    pool: &SqlitePool,
    id: &str,
    series: Option<&str>,
    display_name: Option<&str>,
    is_default: Option<bool>,
    context_window: Option<i64>,
    max_output_tokens: Option<i64>,
) -> AppResult<()> {
    crate::db::llm::update_model(
        pool,
        id,
        series,
        display_name,
        is_default,
        context_window,
        max_output_tokens,
    )
    .await
}

pub async fn delete_model(pool: &SqlitePool, id: &str) -> AppResult<()> {
    crate::db::llm::delete_model(pool, id).await
}

/// Marks candidates the endpoint already stores, so the import dialog can
/// pre-check them instead of offering duplicates.
pub async fn mark_already_added(
    pool: &SqlitePool,
    endpoint_id: &str,
    mut candidates: Vec<LlmModelCandidate>,
) -> AppResult<Vec<LlmModelCandidate>> {
    let stored: std::collections::HashSet<String> =
        crate::db::llm::stored_model_ids(pool, endpoint_id)
            .await?
            .into_iter()
            .collect();
    for candidate in &mut candidates {
        candidate.already_added = stored.contains(&candidate.model_id);
    }
    Ok(candidates)
}

/// A connection test result built from a model listing attempt. Reaching
/// `/models` proves the base URL and key are both usable.
pub fn test_result_from_listing(
    started: Instant,
    listing: AppResult<Vec<LlmModelCandidate>>,
) -> LlmEndpointTestResult {
    let latency_ms = started.elapsed().as_millis() as i64;
    match listing {
        Ok(models) => LlmEndpointTestResult {
            ok: true,
            message: format!("Connected. {} models available.", models.len()),
            latency_ms,
            model_count: Some(models.len()),
        },
        Err(error) => LlmEndpointTestResult {
            ok: false,
            message: error.to_string(),
            latency_ms,
            model_count: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{api_key_key, mask_api_key};

    #[test]
    fn api_keys_are_scoped_by_endpoint() {
        assert_eq!(api_key_key("ep-1"), "llm/ep-1/api_key");
    }

    #[test]
    fn masking_keeps_only_the_ends_of_a_long_key() {
        assert_eq!(mask_api_key("sk-abcdefghijklmnop"), "sk-••••mnop");
    }

    #[test]
    fn masking_hides_short_keys_entirely() {
        assert_eq!(mask_api_key("sk-123"), "••••••••");
        assert_eq!(mask_api_key("12345678"), "••••••••");
    }
}
