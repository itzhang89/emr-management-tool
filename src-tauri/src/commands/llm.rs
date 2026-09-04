//! LLM provider configuration commands.
//!
//! Every command here goes through `chat::providers`, which is the only layer
//! that knows secrets exist. Nothing in this file returns an API key or a custom
//! header value: the frontend sees masks and header names, and writes both one
//! way only.

use crate::chat::{models_sync, providers};
use crate::error::AppResult;
use crate::models::{
    AddLlmApiKeyRequest, AddLlmModelsRequest, CreateLlmProviderRequest, LlmApiKey,
    LlmProviderTestResult, LlmIdRequest, LlmModelCandidate, LlmProtocol, LlmProvider,
    LlmProviderIdRequest, SetLlmProviderHeadersRequest, UpdateLlmApiKeyRequest,
    UpdateLlmModelRequest, UpdateLlmProviderRequest,
};
use serde::Deserialize;
use std::time::Instant;
use tauri::AppHandle;

#[tauri::command]
pub async fn list_llm_providers() -> AppResult<Vec<LlmProvider>> {
    let pool = crate::db::repository::pool().await?;
    providers::list_providers(&pool).await
}

#[tauri::command]
pub async fn create_llm_provider(request: CreateLlmProviderRequest) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;
    providers::create_provider(
        &pool,
        &request.name,
        request.protocol.unwrap_or(LlmProtocol::Openai),
    )
    .await
}

#[tauri::command]
pub async fn update_llm_provider(request: UpdateLlmProviderRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::update_provider(&pool, &request).await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateLlmProviderRequest {
    pub id: String,
    pub name: String,
}

/// Copies a provider's protocol, address, header names, and models under a new
/// name. Its API keys are not copied — a duplicate points at a different account,
/// and cloning a credential would leave two places to revoke it from.
#[tauri::command]
pub async fn duplicate_llm_provider(request: DuplicateLlmProviderRequest) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;
    providers::duplicate_provider(&pool, &request.id, &request.name).await
}

#[tauri::command]
pub async fn delete_llm_provider(app: AppHandle, request: LlmIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::delete_provider(&app, &pool, &request.id).await
}

/// Replaces a provider's custom headers and returns the resulting names.
///
/// Values are write-only, like API keys: a header whose value is omitted keeps
/// whatever is stored, and one absent from the list is removed.
#[tauri::command]
pub async fn set_llm_provider_headers(
    app: AppHandle,
    request: SetLlmProviderHeadersRequest,
) -> AppResult<Vec<String>> {
    let pool = crate::db::repository::pool().await?;
    providers::set_provider_headers(&app, &pool, &request.provider_id, &request.headers).await
}

// --- API keys --------------------------------------------------------------

#[tauri::command]
pub async fn add_llm_api_key(app: AppHandle, request: AddLlmApiKeyRequest) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;
    providers::add_api_key(
        &app,
        &pool,
        &request.provider_id,
        &request.value,
        request.label.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn update_llm_api_key(request: UpdateLlmApiKeyRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::update_api_key(&pool, &request.id, request.label.as_deref(), request.sort_order).await
}

#[tauri::command]
pub async fn delete_llm_api_key(app: AppHandle, request: LlmIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::delete_api_key(&app, &pool, &request.id).await
}

/// Probes every key on a provider and returns them with their new statuses.
///
/// This is the "detect" button: it finds out ahead of time what a real request
/// would discover, so the send path can go straight to a key that works instead
/// of failing over on the user's first message.
#[tauri::command]
pub async fn probe_llm_api_keys(
    app: AppHandle,
    request: LlmProviderIdRequest,
) -> AppResult<Vec<LlmApiKey>> {
    let pool = crate::db::repository::pool().await?;
    let (protocol, base_url) = crate::db::llm::provider_target(&pool, &request.provider_id).await?;
    let headers = providers::read_headers(&app, &request.provider_id)?;

    for key in providers::list_api_keys(&pool, &request.provider_id).await? {
        // A key whose stored value has gone missing is a broken row, not a
        // rejected credential — say so rather than reporting an auth failure.
        let value = match providers::read_api_key_value(&app, &key.id) {
            Ok(value) => value,
            Err(error) => {
                providers::mark_unhealthy(&pool, &key.id, error.message.as_ref()).await?;
                continue;
            }
        };
        match models_sync::list_models(protocol, &base_url, &value, &headers).await {
            Ok(_) => providers::mark_healthy(&pool, &key.id).await?,
            Err(error) => {
                providers::mark_unhealthy(&pool, &key.id, error.message.as_ref()).await?
            }
        }
    }

    providers::list_api_keys(&pool, &request.provider_id).await
}

// --- Connection test and model sync ---------------------------------------

/// Reaching the provider's model list proves the address and key both work,
/// which is what a user means by "test connection" here.
#[tauri::command]
pub async fn test_llm_provider(
    app: AppHandle,
    request: LlmProviderIdRequest,
) -> AppResult<LlmProviderTestResult> {
    let pool = crate::db::repository::pool().await?;
    let started = Instant::now();
    let listing = list_provider_models(&app, &pool, &request.provider_id).await;
    Ok(providers::test_result_from_listing(started, listing))
}

/// Candidates from the provider's `/models`, with the ones already stored marked
/// so the import dialog can pre-check them.
#[tauri::command]
pub async fn sync_llm_models(
    app: AppHandle,
    request: LlmProviderIdRequest,
) -> AppResult<Vec<LlmModelCandidate>> {
    let pool = crate::db::repository::pool().await?;
    let candidates = list_provider_models(&app, &pool, &request.provider_id).await?;
    providers::mark_already_added(&pool, &request.provider_id, candidates).await
}

#[tauri::command]
pub async fn add_llm_models(request: AddLlmModelsRequest) -> AppResult<usize> {
    let pool = crate::db::repository::pool().await?;
    providers::add_models(&pool, &request.provider_id, &request.models).await
}

#[tauri::command]
pub async fn update_llm_model(request: UpdateLlmModelRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::update_model(&pool, &request).await
}

#[tauri::command]
pub async fn delete_llm_model(request: LlmIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::delete_model(&pool, &request.id).await
}

/// Shared by the test and sync commands: resolve the provider's protocol, address,
/// credentials, and headers, then ask it what models it has.
///
/// A refused key is retired here too, so "test connection" and "fetch models" leave
/// the same knowledge behind that a real send would.
async fn list_provider_models(
    app: &AppHandle,
    pool: &sqlx::SqlitePool,
    provider_id: &str,
) -> AppResult<Vec<LlmModelCandidate>> {
    let (protocol, base_url) = crate::db::llm::provider_target(pool, provider_id).await?;
    let credentials = providers::resolve_credentials(app, pool, provider_id).await?;

    match models_sync::list_models(
        protocol,
        &base_url,
        &credentials.api_key,
        &credentials.headers,
    )
    .await
    {
        Ok(models) => {
            providers::mark_healthy(pool, &credentials.key_id).await?;
            Ok(models)
        }
        Err(error) => {
            if providers::error_retires_key(&error) {
                providers::mark_unhealthy(pool, &credentials.key_id, error.message.as_ref())
                    .await?;
            }
            Err(error)
        }
    }
}
