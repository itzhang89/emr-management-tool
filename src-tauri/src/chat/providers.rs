//! LLM provider configuration: the SQLite tree joined with keychain secrets.
//!
//! `db::llm` stores everything except secrets; `crate::secrets` stores the API
//! key values and custom header values. This module is where the two meet, and
//! it is the only place that knows those secrets exist. What crosses to the
//! WebView is masked values the frontend can replace but never read back — the
//! same rule already enforced for AWS secret access keys.

use crate::error::{AppError, AppResult};
use crate::models::{
    AddLlmModelInput, LlmApiKey, LlmApiKeyStatus, LlmProviderTestResult, LlmHeaderInput,
    LlmModelCandidate, LlmProtocol, LlmProvider,
};
use crate::secrets;
use sqlx::SqlitePool;
use std::collections::BTreeMap;
use std::time::Instant;
use tauri::AppHandle;

/// Keychain key for one API key's value. Scoped by key id rather than provider
/// id, because a provider holds several.
pub fn api_key_key(key_id: &str) -> String {
    format!("llm/key/{key_id}")
}

/// Keychain key for a provider's custom request headers, stored as one JSON
/// object. Header values are as sensitive as the API key — gateways routinely
/// want a token in `X-Api-Token` — so they do not go into SQLite.
pub fn headers_key(provider_id: &str) -> String {
    format!("llm/{provider_id}/headers")
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

/// The whole provider tree. Contains no secret — only masks, which `db::llm`
/// already stores — so this is a straight pass-through today, kept as the single
/// entry point so callers never reach past it into the storage layer.
pub async fn list_providers(pool: &SqlitePool) -> AppResult<Vec<LlmProvider>> {
    crate::db::llm::list_providers(pool).await
}

// --- Legacy cleanup --------------------------------------------------------

/// Deletes keychain entries left behind when `db::llm::migrate` dropped tables
/// written by an earlier schema.
///
/// The drop happens in the storage layer, which has no `AppHandle` and so cannot
/// touch the keychain; it records the orphaned keys in a table instead. This
/// drains that record. Leaving the entries behind would keep API keys on the
/// machine after the user's configuration visibly disappeared.
///
/// Returns how many were removed. The record is only cleared once every deletion
/// succeeded, so a failure here is retried on the next start rather than leaking
/// the keys permanently.
pub async fn purge_orphaned_secrets(app: &AppHandle, pool: &SqlitePool) -> AppResult<usize> {
    let keys = crate::db::llm::orphaned_secret_keys(pool).await?;
    if keys.is_empty() {
        return Ok(0);
    }

    let mut removed = 0usize;
    let mut failed = false;
    for key in &keys {
        match secrets::delete_secret(app, key) {
            Ok(()) => removed += 1,
            Err(error) => {
                failed = true;
                crate::diagnostics::append_log_line(
                    "WARN",
                    &format!("Failed to remove the stored secret {key}: {error}"),
                );
            }
        }
    }

    if !failed {
        crate::db::llm::clear_orphaned_secret_keys(pool).await?;
    }
    crate::diagnostics::append_log_line(
        "INFO",
        &format!("Removed {removed} LLM secrets orphaned by an earlier schema."),
    );
    Ok(removed)
}

// --- Providers -------------------------------------------------------------

pub async fn create_provider(
    pool: &SqlitePool,
    name: &str,
    protocol: LlmProtocol,
) -> AppResult<String> {
    crate::db::llm::create_provider(pool, name, protocol).await
}

pub async fn update_provider(
    pool: &SqlitePool,
    request: &crate::models::UpdateLlmProviderRequest,
) -> AppResult<()> {
    crate::db::llm::update_provider(
        pool,
        &request.id,
        request.name.as_deref(),
        request.protocol,
        request.base_url.as_deref(),
        request.enabled,
        request.sort_order,
    )
    .await
}

/// Copies a provider's settings and models under a new name.
///
/// The keychain is untouched: `db::llm::duplicate_provider` copies no keys, and
/// the header *values* are not copied either — only their names, so the form shows
/// what the copy still needs.
pub async fn duplicate_provider(
    pool: &SqlitePool,
    source_id: &str,
    name: &str,
) -> AppResult<String> {
    crate::db::llm::duplicate_provider(pool, source_id, name).await
}

/// Deletes a provider along with its keys, models, and every secret they owned.
/// Secrets go last: if the row deletion fails we have not yet destroyed anything
/// the user might still need.
pub async fn delete_provider(app: &AppHandle, pool: &SqlitePool, id: &str) -> AppResult<()> {
    let deleted = crate::db::llm::delete_provider(pool, id).await?;
    for key_id in &deleted.api_key_ids {
        forget_secret(app, &api_key_key(key_id));
    }
    for provider_id in &deleted.provider_ids {
        forget_secret(app, &headers_key(provider_id));
    }
    Ok(())
}

/// Best-effort secret removal. A failure here must not abort the delete — the
/// rows are already gone, and retrying is impossible without them.
fn forget_secret(app: &AppHandle, key: &str) {
    if let Err(error) = secrets::delete_secret(app, key) {
        crate::diagnostics::append_log_line(
            "WARN",
            &format!("Failed to remove the stored secret {key}: {error}"),
        );
    }
}

// --- Custom headers --------------------------------------------------------

/// Applies a submitted header list: names absent from it are removed, and an
/// entry with no value keeps whatever is stored.
///
/// The whole set is submitted at once so editing one header does not require
/// retyping the others' values — which the frontend cannot do, since it never
/// receives them.
pub async fn set_provider_headers(
    app: &AppHandle,
    pool: &SqlitePool,
    provider_id: &str,
    submitted: &[LlmHeaderInput],
) -> AppResult<Vec<String>> {
    // Which names are reserved depends on the protocol, and headers may be
    // configured before the address — so this reads the protocol alone rather than
    // going through `provider_target`, which insists on an address.
    let protocol = crate::db::llm::provider_protocol(pool, provider_id).await?;
    let stored = read_headers(app, provider_id)?;
    let mut next: BTreeMap<String, String> = BTreeMap::new();

    for header in submitted {
        let name = header.name.trim();
        if name.is_empty() {
            continue;
        }
        validate_header_name(name, protocol)?;
        let value = match header.value.as_deref() {
            Some(value) => value.to_string(),
            // Omitted means "keep what is stored"; a header whose value we do not
            // have and were not given cannot be kept.
            None => match stored.get(name) {
                Some(value) => value.clone(),
                None => {
                    return Err(AppError::validation(format!(
                        "Header {name} has no stored value. Enter one."
                    )))
                }
            },
        };
        if value.trim().is_empty() {
            return Err(AppError::validation(format!(
                "Header {name} needs a value, or remove it."
            )));
        }
        next.insert(name.to_string(), value);
    }

    let names: Vec<String> = next.keys().cloned().collect();
    if next.is_empty() {
        forget_secret(app, &headers_key(provider_id));
    } else {
        let encoded =
            serde_json::to_string(&next).map_err(|error| AppError::internal(error.to_string()))?;
        secrets::write_secret(app, &headers_key(provider_id), &encoded)?;
    }
    crate::db::llm::set_provider_header_names(pool, provider_id, &names).await?;
    Ok(names)
}

/// Rejects a custom header that would shadow one the protocol sets itself.
/// Silently overriding the auth header would make "the key is wrong" impossible
/// to diagnose.
fn validate_header_name(name: &str, protocol: LlmProtocol) -> AppResult<()> {
    if name.contains(|c: char| c.is_whitespace() || c == ':') {
        return Err(AppError::validation(format!(
            "{name} is not a valid header name."
        )));
    }
    let lower = name.to_ascii_lowercase();
    if protocol
        .reserved_header_names()
        .iter()
        .any(|reserved| *reserved == lower)
    {
        return Err(AppError::validation(format!(
            "{name} is set by the {} protocol itself and cannot be overridden.",
            protocol.as_str()
        )));
    }
    Ok(())
}

/// The custom headers of a provider, for the chat and sync paths. Never returned
/// through a Tauri command.
pub fn read_headers(app: &AppHandle, provider_id: &str) -> AppResult<BTreeMap<String, String>> {
    let Some(raw) = secrets::read_optional_secret(app, &headers_key(provider_id))? else {
        return Ok(BTreeMap::new());
    };
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

// --- API keys --------------------------------------------------------------

/// Stores a key's value in the keychain and its metadata in SQLite.
pub async fn add_api_key(
    app: &AppHandle,
    pool: &SqlitePool,
    provider_id: &str,
    value: &str,
    label: Option<&str>,
) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::validation("An API key value is required."));
    }

    let id = crate::db::llm::add_api_key(pool, provider_id, &mask_api_key(value), label).await?;
    if let Err(error) = secrets::write_secret(app, &api_key_key(&id), value) {
        // Do not leave a row pointing at a key that was never stored.
        let _ = crate::db::llm::delete_api_key(pool, &id).await;
        return Err(error);
    }
    Ok(id)
}

pub async fn update_api_key(
    pool: &SqlitePool,
    id: &str,
    label: Option<&str>,
    sort_order: Option<i64>,
) -> AppResult<()> {
    crate::db::llm::update_api_key(pool, id, label, sort_order).await
}

pub async fn delete_api_key(app: &AppHandle, pool: &SqlitePool, id: &str) -> AppResult<()> {
    crate::db::llm::delete_api_key(pool, id).await?;
    forget_secret(app, &api_key_key(id));
    Ok(())
}

pub async fn list_api_keys(pool: &SqlitePool, provider_id: &str) -> AppResult<Vec<LlmApiKey>> {
    crate::db::llm::list_api_keys(pool, provider_id).await
}

/// The key a provider should send with: the first in the user's order that has
/// not been found unhealthy.
///
/// Deliberately *not* round-robin. Rotating per request would scatter one
/// conversation's turns across several keys, which splits the provider's prompt
/// caching and makes quota attribution unreadable. Rotation happens on failure
/// instead — see `mark_unhealthy`.
pub fn pick_api_key(keys: &[LlmApiKey]) -> Option<&LlmApiKey> {
    keys.iter()
        .find(|key| key.status != LlmApiKeyStatus::Unhealthy)
}

/// The next key to try after `after_id` was refused.
pub fn next_api_key_after<'a>(keys: &'a [LlmApiKey], after_id: &str) -> Option<&'a LlmApiKey> {
    let position = keys.iter().position(|key| key.id == after_id)?;
    keys[position + 1..]
        .iter()
        .find(|key| key.status != LlmApiKeyStatus::Unhealthy)
}

/// Whether an error means "this API key is no good" as opposed to "this request
/// was bad". Only the former should retire a key.
///
/// The judgement is made where the HTTP status was seen — the protocol modules
/// tag those errors — so this only reads the tag. Rate limiting is deliberately
/// not tagged: it proves the key works.
pub fn error_retires_key(error: &AppError) -> bool {
    error.code.as_ref() == crate::chat::protocol::AUTH_REJECTED_CODE
}

/// Records that a key was refused, so later sends skip it.
pub async fn mark_unhealthy(pool: &SqlitePool, key_id: &str, message: &str) -> AppResult<()> {
    crate::db::llm::set_api_key_status(pool, key_id, LlmApiKeyStatus::Unhealthy, Some(message)).await
}

/// Records that a key answered, clearing any earlier refusal.
pub async fn mark_healthy(pool: &SqlitePool, key_id: &str) -> AppResult<()> {
    crate::db::llm::set_api_key_status(pool, key_id, LlmApiKeyStatus::Healthy, None).await
}

/// Reads one key's value. Never returned through a Tauri command.
pub fn read_api_key_value(app: &AppHandle, key_id: &str) -> AppResult<String> {
    secrets::read_optional_secret(app, &api_key_key(key_id))?.ok_or_else(|| {
        AppError::storage("This API key's stored value is missing. Remove it and add it again.")
    })
}

/// The credentials for one request: the chosen key's id and value, plus any
/// custom headers.
pub struct ProviderCredentials {
    pub key_id: String,
    pub api_key: String,
    pub headers: BTreeMap<String, String>,
}

/// Resolves what to send with, explaining the two distinguishable failures:
/// nothing configured at all, versus every key already refused.
pub async fn resolve_credentials(
    app: &AppHandle,
    pool: &SqlitePool,
    provider_id: &str,
) -> AppResult<ProviderCredentials> {
    let keys = list_api_keys(pool, provider_id).await?;
    if keys.is_empty() {
        return Err(AppError::validation(
            "This provider has no API key configured. Add one before using it.",
        ));
    }
    let key = pick_api_key(&keys).ok_or_else(|| {
        AppError::validation(format!(
            "All {} API keys on this provider were refused. Check them in LLM Setting.",
            keys.len()
        ))
    })?;

    Ok(ProviderCredentials {
        key_id: key.id.clone(),
        api_key: read_api_key_value(app, &key.id)?,
        headers: read_headers(app, provider_id)?,
    })
}

// --- Models ----------------------------------------------------------------

pub async fn add_models(
    pool: &SqlitePool,
    provider_id: &str,
    models: &[AddLlmModelInput],
) -> AppResult<usize> {
    crate::db::llm::add_models(pool, provider_id, models).await
}

pub async fn update_model(
    pool: &SqlitePool,
    request: &crate::models::UpdateLlmModelRequest,
) -> AppResult<()> {
    crate::db::llm::update_model(
        pool,
        &request.id,
        request.model_id.as_deref(),
        request.series.as_deref(),
        request.display_name.as_deref(),
        request.model_type,
        request.capabilities,
        request.is_default,
        request.context_window,
        request.max_input_tokens,
        request.max_output_tokens,
    )
    .await
}

pub async fn delete_model(pool: &SqlitePool, id: &str) -> AppResult<()> {
    crate::db::llm::delete_model(pool, id).await
}

/// Marks candidates the provider already stores, so the import dialog can
/// pre-check them instead of offering duplicates.
pub async fn mark_already_added(
    pool: &SqlitePool,
    provider_id: &str,
    mut candidates: Vec<LlmModelCandidate>,
) -> AppResult<Vec<LlmModelCandidate>> {
    let stored: std::collections::HashSet<String> =
        crate::db::llm::stored_model_ids(pool, provider_id)
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
) -> LlmProviderTestResult {
    let latency_ms = started.elapsed().as_millis() as i64;
    match listing {
        Ok(models) => LlmProviderTestResult {
            ok: true,
            message: format!("Connected. {} models available.", models.len()),
            latency_ms,
            model_count: Some(models.len()),
        },
        Err(error) => LlmProviderTestResult {
            ok: false,
            message: error.to_string(),
            latency_ms,
            model_count: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn key(id: &str, status: LlmApiKeyStatus) -> LlmApiKey {
        LlmApiKey {
            id: id.to_string(),
            provider_id: "prov-1".to_string(),
            label: None,
            masked: "sk-••••abcd".to_string(),
            status,
            status_message: None,
            checked_at: None,
            sort_order: 0,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn secrets_are_scoped_by_the_row_that_owns_them() {
        assert_eq!(api_key_key("k-1"), "llm/key/k-1");
        assert_eq!(headers_key("prov-1"), "llm/prov-1/headers");
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

    #[test]
    fn the_first_usable_key_is_picked_not_the_next_one_in_rotation() {
        let keys = vec![
            key("a", LlmApiKeyStatus::Healthy),
            key("b", LlmApiKeyStatus::Healthy),
        ];
        // Called twice, the same key comes back: rotation happens on failure, not
        // per request.
        assert_eq!(pick_api_key(&keys).unwrap().id, "a");
        assert_eq!(pick_api_key(&keys).unwrap().id, "a");
    }

    #[test]
    fn unhealthy_keys_are_skipped_including_when_they_lead() {
        let keys = vec![
            key("a", LlmApiKeyStatus::Unhealthy),
            key("b", LlmApiKeyStatus::Unknown),
        ];
        // Unknown is not a failure — nothing has probed it yet.
        assert_eq!(pick_api_key(&keys).unwrap().id, "b");

        let all_bad = vec![key("a", LlmApiKeyStatus::Unhealthy)];
        assert!(pick_api_key(&all_bad).is_none());
        assert!(pick_api_key(&[]).is_none());
    }

    #[test]
    fn the_retry_key_comes_after_the_one_that_failed() {
        let keys = vec![
            key("a", LlmApiKeyStatus::Healthy),
            key("b", LlmApiKeyStatus::Unhealthy),
            key("c", LlmApiKeyStatus::Unknown),
        ];
        // b is already known bad, so the retry skips to c.
        assert_eq!(next_api_key_after(&keys, "a").unwrap().id, "c");
        // Nothing left after the last one.
        assert!(next_api_key_after(&keys, "c").is_none());
        assert!(next_api_key_after(&keys, "missing").is_none());
    }

    #[test]
    fn only_auth_failures_retire_a_key() {
        use crate::chat::protocol::http_failure;

        assert!(error_retires_key(&http_failure(401, "bad key".to_string())));
        assert!(error_retires_key(&http_failure(403, "forbidden".to_string())));
        // Being rate limited proves the key works.
        assert!(!error_retires_key(&http_failure(429, "slow".to_string())));
        assert!(!error_retires_key(&http_failure(400, "bad body".to_string())));
        // A transport failure says nothing about the key.
        assert!(!error_retires_key(&AppError::internal("dns failure")));
    }

    #[test]
    fn a_protocols_own_headers_cannot_be_overridden() {
        assert!(validate_header_name("Authorization", LlmProtocol::Openai).is_err());
        assert!(validate_header_name("authorization", LlmProtocol::Openai).is_err());
        assert!(validate_header_name("X-Api-Key", LlmProtocol::Anthropic).is_err());
        assert!(validate_header_name("anthropic-version", LlmProtocol::Anthropic).is_err());
        assert!(validate_header_name("x-goog-api-key", LlmProtocol::Gemini).is_err());

        // A header reserved by one protocol is fine under another.
        assert!(validate_header_name("Authorization", LlmProtocol::Gemini).is_ok());
        assert!(validate_header_name("X-Api-Token", LlmProtocol::Openai).is_ok());
    }

    #[test]
    fn malformed_header_names_are_rejected() {
        assert!(validate_header_name("X Api Token", LlmProtocol::Openai).is_err());
        assert!(validate_header_name("X-Api:Token", LlmProtocol::Openai).is_err());
    }
}
