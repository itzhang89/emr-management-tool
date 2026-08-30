//! Chat assistant, session, and message commands.
//!
//! Persistence only — the streaming send loop lands in a later batch. Reads go
//! straight to `db::chat`; the request-history rule (everything after the last
//! context reset) lives there too, so the send loop and these commands cannot
//! disagree about what the model sees.

use crate::error::{AppError, AppResult};
use crate::models::{
    ChatAssistant, ChatIdRequest, ChatMessage, ChatSendRequest, ChatSession, ChatSessionIdRequest,
    CreateChatAssistantRequest, CreateChatSessionRequest, UpdateChatAssistantRequest,
    UpdateChatSessionRequest,
};
use crate::state::AppState;
use tauri::{AppHandle, State as TauriState};

#[tauri::command]
pub async fn list_chat_assistants() -> AppResult<Vec<ChatAssistant>> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::list_assistants(&pool).await
}

#[tauri::command]
pub async fn create_chat_assistant(request: CreateChatAssistantRequest) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::create_assistant(
        &pool,
        &request.name,
        request.system_prompt.as_deref(),
        request.default_model_id.as_deref(),
        request.enabled_tools.as_deref(),
        request.accent.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn update_chat_assistant(request: UpdateChatAssistantRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::update_assistant(
        &pool,
        &request.id,
        crate::db::chat::AssistantPatch {
            name: request.name.as_deref(),
            system_prompt: request.system_prompt.as_deref(),
            default_model_id: request.default_model_id.as_deref(),
            // The nested Option keeps "field absent" (leave it) distinct from
            // "explicitly null" (allow every tool again).
            enabled_tools: request.enabled_tools.as_ref().map(|tools| tools.as_deref()),
            accent: request.accent.as_deref(),
            sort_order: request.sort_order,
        },
    )
    .await
}

#[tauri::command]
pub async fn delete_chat_assistant(request: ChatIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::delete_assistant(&pool, &request.id).await
}

#[tauri::command]
pub async fn list_chat_sessions() -> AppResult<Vec<ChatSession>> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::list_sessions(&pool).await
}

#[tauri::command]
pub async fn create_chat_session(request: CreateChatSessionRequest) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::create_session(
        &pool,
        &request.assistant_id,
        request.title.as_deref(),
        request.model_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn update_chat_session(request: UpdateChatSessionRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::update_session(
        &pool,
        &request.id,
        request.title.as_deref(),
        request.model_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn delete_chat_session(request: ChatIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::delete_session(&pool, &request.id).await
}

/// Removes every conversation. Assistants are presets and stay.
///
/// Offered because tool results persist to the local database, so a user who
/// analysed a sensitive job needs one action that clears the lot.
#[tauri::command]
pub async fn delete_all_chat_sessions() -> AppResult<u64> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::delete_all_sessions(&pool).await
}

#[tauri::command]
pub async fn list_chat_messages(request: ChatSessionIdRequest) -> AppResult<Vec<ChatMessage>> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::list_messages(&pool, &request.session_id).await
}

/// Marks the point after which earlier turns stop being sent to the model. The
/// messages stay visible; only the request history is cut. Returns false when
/// there was nothing to clear.
#[tauri::command]
pub async fn clear_chat_context(request: ChatSessionIdRequest) -> AppResult<bool> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::append_context_reset(&pool, &request.session_id).await
}

/// Sends a message and runs the model's tool calls to completion.
///
/// Returns the assistant message id once the exchange finishes. Progress arrives
/// meanwhile as `chat:delta`, `chat:tool`, `chat:done`, and `chat:error` events,
/// so the UI streams rather than waiting on this call.
#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    app_state: TauriState<'_, AppState>,
    request: ChatSendRequest,
) -> AppResult<String> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err(AppError::validation("Enter a message to send."));
    }

    let cancel = tokio_util::sync::CancellationToken::new();
    {
        let mut cancellations = app_state
            .chat_cancellations
            .lock()
            .map_err(|error| AppError::internal(format!("Failed to acquire chat lock: {error}")))?;
        // A second send for the same session supersedes the first, so the older
        // stream is stopped rather than left racing this one into the transcript.
        if let Some(previous) = cancellations.insert(request.session_id.clone(), cancel.clone()) {
            previous.cancel();
        }
    }

    let pool = crate::db::repository::pool().await?;
    let outcome = crate::chat::session::send(
        &app,
        &pool,
        &app_state.in_process_mcp,
        &request.session_id,
        text,
        cancel,
    )
    .await;

    if let Ok(mut cancellations) = app_state.chat_cancellations.lock() {
        cancellations.remove(&request.session_id);
    }

    outcome
}

/// Interrupts a streaming send. Whatever was streamed so far stays in the
/// transcript — stopping is a user action, not a failure.
#[tauri::command]
pub async fn chat_cancel(
    app_state: TauriState<'_, AppState>,
    request: ChatSessionIdRequest,
) -> AppResult<bool> {
    let token = {
        let cancellations = app_state
            .chat_cancellations
            .lock()
            .map_err(|error| AppError::internal(format!("Failed to acquire chat lock: {error}")))?;
        cancellations.get(&request.session_id).cloned()
    };

    match token {
        Some(token) => {
            token.cancel();
            Ok(true)
        }
        None => Ok(false),
    }
}
