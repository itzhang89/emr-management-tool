//! LLM provider configuration commands.
//!
//! Every command here goes through `chat::providers`, which is the only layer
//! that knows API keys exist. Nothing in this file returns a key: the frontend
//! sees `hasApiKey` and a masked value, and writes keys one way only.

use crate::chat::{models_sync, providers};
use crate::error::AppResult;
use crate::models::{
    AddLlmModelsRequest, CreateLlmEndpointRequest, CreateLlmProviderRequest, LlmEndpointIdRequest,
    LlmEndpointTestResult, LlmIdRequest, LlmModelCandidate, LlmProvider, UpdateLlmEndpointRequest,
    UpdateLlmModelRequest, UpdateLlmProviderRequest,
};
use std::time::Instant;
use tauri::AppHandle;

#[tauri::command]
pub async fn list_llm_providers(app: AppHandle) -> AppResult<Vec<LlmProvider>> {
    let pool = crate::db::repository::pool().await?;
    providers::list_providers(&app, &pool).await
}

#[tauri::command]
pub async fn create_llm_provider(request: CreateLlmProviderRequest) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;
    providers::create_provider(&pool, &request.name, request.kind).await
}

#[tauri::command]
pub async fn update_llm_provider(request: UpdateLlmProviderRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::update_provider(
        &pool,
        &request.id,
        request.name.as_deref(),
        request.enabled,
        request.sort_order,
    )
    .await
}

#[tauri::command]
pub async fn delete_llm_provider(app: AppHandle, request: LlmIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::delete_provider(&app, &pool, &request.id).await
}

#[tauri::command]
pub async fn create_llm_endpoint(
    app: AppHandle,
    request: CreateLlmEndpointRequest,
) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;
    providers::create_endpoint(
        &app,
        &pool,
        &request.provider_id,
        &request.name,
        &request.base_url,
        request.api_key.as_deref(),
        request.is_default.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn update_llm_endpoint(
    app: AppHandle,
    request: UpdateLlmEndpointRequest,
) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::update_endpoint(
        &app,
        &pool,
        &request.id,
        request.name.as_deref(),
        request.base_url.as_deref(),
        request.api_key.as_deref(),
        request.is_default,
    )
    .await
}

#[tauri::command]
pub async fn delete_llm_endpoint(app: AppHandle, request: LlmIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::delete_endpoint(&app, &pool, &request.id).await
}

/// Reaching the endpoint's model list proves the base URL and key both work,
/// which is what a user means by "test connection" here.
#[tauri::command]
pub async fn test_llm_endpoint(
    app: AppHandle,
    request: LlmEndpointIdRequest,
) -> AppResult<LlmEndpointTestResult> {
    let pool = crate::db::repository::pool().await?;
    let started = Instant::now();
    let listing = list_endpoint_models(&app, &pool, &request.endpoint_id).await;
    Ok(providers::test_result_from_listing(started, listing))
}

/// Candidates from the provider's `/models`, with the ones already stored
/// marked so the import dialog can pre-check them.
#[tauri::command]
pub async fn sync_llm_models(
    app: AppHandle,
    request: LlmEndpointIdRequest,
) -> AppResult<Vec<LlmModelCandidate>> {
    let pool = crate::db::repository::pool().await?;
    let candidates = list_endpoint_models(&app, &pool, &request.endpoint_id).await?;
    providers::mark_already_added(&pool, &request.endpoint_id, candidates).await
}

#[tauri::command]
pub async fn add_llm_models(request: AddLlmModelsRequest) -> AppResult<usize> {
    let pool = crate::db::repository::pool().await?;
    providers::add_models(&pool, &request.endpoint_id, &request.models).await
}

#[tauri::command]
pub async fn update_llm_model(request: UpdateLlmModelRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::update_model(
        &pool,
        &request.id,
        request.series.as_deref(),
        request.display_name.as_deref(),
        request.is_default,
        request.context_window,
        request.max_output_tokens,
    )
    .await
}

#[tauri::command]
pub async fn delete_llm_model(request: LlmIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    providers::delete_model(&pool, &request.id).await
}

/// Shared by the test and sync commands: resolve the endpoint's shape, base URL,
/// and key, then ask it what models it has.
async fn list_endpoint_models(
    app: &AppHandle,
    pool: &sqlx::SqlitePool,
    endpoint_id: &str,
) -> AppResult<Vec<LlmModelCandidate>> {
    let (kind, base_url) = crate::db::llm::endpoint_target(pool, endpoint_id).await?;
    let api_key = providers::read_api_key(app, endpoint_id)?;
    models_sync::list_models(kind, &base_url, &api_key).await
}
