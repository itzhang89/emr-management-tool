//! Chat assistant, session, and message commands.
//!
//! Persistence only — the streaming send loop lands in a later batch. Reads go
//! straight to `db::chat`; the request-history rule (everything after the last
//! context reset) lives there too, so the send loop and these commands cannot
//! disagree about what the model sees.

use crate::error::{AppError, AppResult};
use crate::models::{
    ChatAssistant, ChatIdRequest, ChatMessage, ChatMessageIdRequest, ChatRegenerateRequest,
    ChatSendRequest, ChatSession, ChatSessionIdRequest, ChatSetMessageVersionRequest,
    ChatUpdateMessageRequest, CreateChatAssistantRequest, CreateChatSessionRequest,
    UpdateChatAssistantRequest, UpdateChatSessionRequest,
};
use crate::state::AppState;
use sqlx::SqlitePool;
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
    run_send(&app, &app_state, &request.session_id, request.text, None).await
}

/// Regenerates one assistant reply: discards that reply and everything after it,
/// then re-answers the question it answered.
///
/// `model_id` in the request switches the model for this reply only — the
/// session's own default is left alone.
#[tauri::command]
pub async fn regenerate_chat_message(
    app: AppHandle,
    app_state: TauriState<'_, AppState>,
    request: ChatRegenerateRequest,
) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;

    // Find the message being regenerated and the question it answered. A reply
    // can only be re-answered while that question still exists above it.
    let target = crate::db::chat::get_message(&pool, &request.session_id, &request.message_id)
        .await?;
    if target.role != crate::models::ChatRole::Assistant {
        return Err(AppError::validation(
            "Only an assistant message can be regenerated.",
        ));
    }
    let old_message_id = target.id.clone();
    let prior = crate::db::chat::list_messages(&pool, &request.session_id).await?;
    let question = prior
        .iter()
        .rev()
        .find(|m| m.role == crate::models::ChatRole::User && m.seq <= target.seq)
        .cloned()
        .ok_or_else(|| {
            AppError::validation("There is no question to regenerate an answer for.")
        })?;

    // Regenerating on the *same* model overwrites the answer in place — the
    // numbered version the user is looking at is replaced, not added to. Only a
    // genuinely different model (@) branches the reply into a new numbered
    // version worth keeping to compare against.
    let appends_version = request
        .model_id
        .as_deref()
        .is_some_and(|picked| picked != target.model_id.as_deref().unwrap_or_default());
    // The version currently shown, captured before the row is discarded so an
    // in-place overwrite can drop it and a failed re-answer can restore it.
    let previously_active = prior
        .iter()
        .find(|m| m.id == old_message_id)
        .and_then(|m| m.versions.iter().find(|version| version.is_active).map(|v| v.id.clone()));

    // The model must resolve before anything is discarded: if the picked model
    // cannot be found (e.g. its provider was removed), regenerating should leave
    // the current answer on screen with a clear error rather than deleting it
    // and whatever followed and then failing. Answering resolves again later —
    // this is only an early, transcript-preserving guard.
    let model_override = request.model_id.or(target.model_id);
    crate::chat::session::resolve_model(&pool, &request.session_id, model_override.as_deref())
        .await?;

    // Discard the old reply and everything after it, keeping the question. The
    // model override applies only to this reply; the session default is intact.
    // Version rows are *not* cascade-deleted here — they are re-pointed onto the
    // fresh assistant row below so the superseded answers stay switchable.
    crate::db::chat::delete_messages_from(&pool, &request.session_id, question.seq + 1).await?;
    assert_last_user(&pool, &request.session_id).await?;

    let outcome = run_send_on_existing_turn(
        &app,
        &app_state,
        &request.session_id,
        model_override,
    )
    .await;

    // Whether the re-answer succeeded or left an error row, the answer loop
    // appended exactly one assistant message right after the question. Move the
    // old reply's archived versions onto it so its history survives, then decide
    // what the numbering should be.
    if let Ok(messages) = crate::db::chat::list_messages(&pool, &request.session_id).await {
        let replacement = messages
            .iter()
            .find(|m| m.role == crate::models::ChatRole::Assistant && m.seq == question.seq + 1);
        if let Some(replacement) = replacement {
            // Only a real completion earns a fresh active version (finish archives
            // none for an error or an empty reply), so before re-attaching we can
            // tell whether this attempt actually landed.
            let fresh_answer_landed = replacement.versions.iter().any(|version| version.is_active);

            let _ = crate::db::chat::reattach_message_versions(
                &pool,
                &old_message_id,
                &replacement.id,
            )
            .await;

            if !fresh_answer_landed {
                // The re-answer failed or came back empty — it must not eat the
                // working reply it was meant to replace, so put the previously
                // shown version back on display (the transcript then reads as if
                // the attempt never happened; the error surfaces as a toast).
                if let Some(active) = &previously_active {
                    let _ = crate::db::chat::activate_message_version(
                        &pool,
                        &request.session_id,
                        &replacement.id,
                        active,
                    )
                    .await;
                }
            } else if !appends_version {
                // A same-model overwrite: the answer this re-run replaced is gone,
                // so its version row goes with it — the count stays put instead of
                // the number marching up on every regenerate.
                if let Some(active) = &previously_active {
                    let _ = crate::db::chat::delete_message_version(
                        &pool,
                        &request.session_id,
                        active,
                    )
                    .await;
                }
            }
            // A different model (@) that landed keeps every past answer, and the
            // fresh one sits at the end as a new numbered version — nothing more
            // to do after the re-attach.
        }
    }
    // Any version rows still pointing at messages that were truly discarded (the
    // tail after the question) are now orphans.
    let _ = crate::db::chat::purge_orphan_message_versions(&pool, &request.session_id).await;

    outcome
}

/// Makes one recorded answer the message's displayed version. The row's columns
/// are overwritten with that version's content, so the transcript and the next
/// request's context both reflect it immediately.
#[tauri::command]
pub async fn set_chat_message_version(request: ChatSetMessageVersionRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::activate_message_version(
        &pool,
        &request.session_id,
        &request.message_id,
        &request.version_id,
    )
    .await
}

/// Replaces a past question with new text, discards every later turn, and
/// re-answers — the edit action.
#[tauri::command]
pub async fn update_chat_message(
    app: AppHandle,
    app_state: TauriState<'_, AppState>,
    request: ChatUpdateMessageRequest,
) -> AppResult<String> {
    let pool = crate::db::repository::pool().await?;
    let target = crate::db::chat::get_message(&pool, &request.session_id, &request.message_id)
        .await?;
    if target.role != crate::models::ChatRole::User {
        return Err(AppError::validation(
            "Only a question of yours can be edited.",
        ));
    }

    let content = request.content.trim();
    if content.is_empty() {
        return Err(AppError::validation("Enter a message to save."));
    }
    crate::db::chat::update_message_content(&pool, &request.message_id, content).await?;
    // A reply once existed for the old wording; the new one follows the edit. The
    // old reply and every later turn are discarded, so their versions go too.
    crate::db::chat::delete_messages_from(&pool, &request.session_id, target.seq + 1).await?;
    assert_last_user(&pool, &request.session_id).await?;
    let _ = crate::db::chat::purge_orphan_message_versions(&pool, &request.session_id).await;

    run_send_on_existing_turn(&app, &app_state, &request.session_id, None).await
}

/// Guards the truncations above: after removing everything past the answered
/// question, that question must be the transcript's last message so the answer
/// loop has exactly what it needs.
async fn assert_last_user(pool: &SqlitePool, session_id: &str) -> AppResult<()> {
    let messages = crate::db::chat::list_messages(pool, session_id).await?;
    match messages.last() {
        Some(last) if last.role == crate::models::ChatRole::User => Ok(()),
        _ => Err(AppError::validation(
            "There is no question left to answer after this change.",
        )),
    }
}

/// Sets up a cancellation token for a send against a turn that is already the
/// last stored user message, then runs the answer loop.
async fn run_send_on_existing_turn(
    app: &AppHandle,
    app_state: &TauriState<'_, AppState>,
    session_id: &str,
    model_override: Option<String>,
) -> AppResult<String> {
    let cancel = tokio_util::sync::CancellationToken::new();
    {
        let mut cancellations = app_state
            .chat_cancellations
            .lock()
            .map_err(|error| AppError::internal(format!("Failed to acquire chat lock: {error}")))?;
        if let Some(previous) = cancellations.insert(session_id.to_string(), cancel.clone()) {
            previous.cancel();
        }
    }

    let pool = crate::db::repository::pool().await?;
    let outcome = crate::chat::session::answer_current_turn(
        app,
        &pool,
        &app_state.in_process_mcp,
        session_id,
        model_override.as_deref(),
        &cancel,
    )
    .await;

    if let Ok(mut cancellations) = app_state.chat_cancellations.lock() {
        cancellations.remove(session_id);
    }

    outcome
}

/// Sets up the send wrapper the message commands share: a cancellation token per
/// session, mirrored from the UI's stop button, then the send loop.
async fn run_send(
    app: &AppHandle,
    app_state: &TauriState<'_, AppState>,
    session_id: &str,
    text: String,
    model_override: Option<String>,
) -> AppResult<String> {
    let text = text.trim();
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
        if let Some(previous) = cancellations.insert(session_id.to_string(), cancel.clone()) {
            previous.cancel();
        }
    }

    let pool = crate::db::repository::pool().await?;
    let outcome = crate::chat::session::send_with_model(
        app,
        &pool,
        &app_state.in_process_mcp,
        session_id,
        text,
        model_override.as_deref(),
        cancel,
    )
    .await;

    if let Ok(mut cancellations) = app_state.chat_cancellations.lock() {
        cancellations.remove(session_id);
    }

    outcome
}

/// Deletes a single message. The message before it is kept even if that leaves a
/// gap, but the conversation can never be left opening with an assistant turn.
#[tauri::command]
pub async fn delete_chat_message(request: ChatMessageIdRequest) -> AppResult<()> {
    let pool = crate::db::repository::pool().await?;
    crate::db::chat::delete_message(&pool, &request.session_id, &request.message_id).await
}

/// Deletes a message and everything after it.
#[tauri::command]
pub async fn delete_chat_messages_from(request: ChatMessageIdRequest) -> AppResult<u64> {
    let pool = crate::db::repository::pool().await?;
    let target = crate::db::chat::get_message(&pool, &request.session_id, &request.message_id)
        .await?;
    let removed = crate::db::chat::delete_messages_from(&pool, &request.session_id, target.seq)
        .await?;
    // The removed rows' version children are no longer reachable.
    let _ = crate::db::chat::purge_orphan_message_versions(&pool, &request.session_id).await;
    Ok(removed)
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
