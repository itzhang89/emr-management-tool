//! The multi-round chat loop.
//!
//! One `send` call may involve several requests to the provider: the model asks
//! for tools, the tools run in-process against AWS, their results go back, and
//! the model continues until it answers without asking for more. Progress is
//! reported to the UI as Tauri events while this runs.

use super::protocol::{parse_tool_arguments, StreamEvent, ToolDefinition, Turn, Usage};
use super::providers;
use crate::error::{AppError, AppResult};
use crate::models::{ChatMessage, ChatRole, ChatToolCall, LlmProviderKind};
use serde::Serialize;
use sqlx::SqlitePool;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Ceiling on provider round-trips per send. A model that keeps calling tools
/// without concluding would otherwise loop indefinitely, spending money and
/// hammering AWS.
const MAX_ROUNDS: usize = 12;

/// Tool output sent back to the model is capped: a full log tail can be enormous,
/// and blowing the context window makes the model worse, not better.
const MAX_TOOL_RESULT_CHARS: usize = 60_000;

// --- Events ---------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaEvent {
    pub session_id: String,
    pub message_id: String,
    pub text: String,
}

/// A tool step, emitted twice: once when it starts and once when it ends. The UI
/// renders the collapsible step from these, so the user sees which AWS reads the
/// model performed while they happen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEvent {
    pub session_id: String,
    pub message_id: String,
    pub call_id: String,
    pub tool: String,
    pub args: serde_json::Value,
    /// "start" | "end"
    pub phase: &'static str,
    pub duration_ms: Option<i64>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneEvent {
    pub session_id: String,
    pub message_id: String,
    pub duration_ms: i64,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent {
    pub session_id: String,
    pub message_id: String,
    pub message: String,
}

/// A conversation that just earned a name from its first message. Emitted as soon
/// as the title is known rather than when the answer finishes, because the answer
/// can take a minute of tool calls and the sidebar should not say "New
/// conversation" for all of it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleEvent {
    pub session_id: String,
    pub title: String,
}

pub const EVENT_DELTA: &str = "chat:delta";
pub const EVENT_TOOL: &str = "chat:tool";
pub const EVENT_DONE: &str = "chat:done";
pub const EVENT_ERROR: &str = "chat:error";
pub const EVENT_TITLE: &str = "chat:title";

// --- Resolving what to send with ------------------------------------------

/// Everything needed to talk to a provider for one session.
pub struct ResolvedTarget {
    pub kind: LlmProviderKind,
    pub base_url: String,
    pub api_key: String,
    /// The id the API expects, e.g. "claude-opus-4-8".
    pub model_id: String,
    pub system_prompt: Option<String>,
    /// `None` means every tool is available.
    pub enabled_tools: Option<Vec<String>>,
}

/// Picks the model for a session: an explicit override for this one send, else
/// the session's own choice, else its assistant's default, else the
/// globally-default model. Each fallback is a deliberate step rather than an
/// arbitrary pick, so a user who set a default gets it everywhere.
pub async fn resolve_target(
    app: &AppHandle,
    pool: &SqlitePool,
    session_id: &str,
    model_override: Option<&str>,
) -> AppResult<ResolvedTarget> {
    let sessions = crate::db::chat::list_sessions(pool).await?;
    let session = sessions
        .into_iter()
        .find(|session| session.id == session_id)
        .ok_or_else(|| {
            AppError::validation(format!("Chat session {session_id} was not found."))
        })?;

    let assistants = crate::db::chat::list_assistants(pool).await?;
    let assistant = assistants
        .into_iter()
        .find(|assistant| assistant.id == session.assistant_id)
        .ok_or_else(|| AppError::validation("This session's assistant no longer exists."))?;

    // An override for a single send (a regenerate with a picked model) precedes
    // the session's stored choice, which itself precedes every fallback.
    let wanted_model_id = model_override
        .map(ToString::to_string)
        .or_else(|| session.model_id.clone())
        .or_else(|| assistant.default_model_id.clone());

    // Walk the provider tree to find the model, its endpoint, and its provider.
    let providers_tree = crate::db::llm::list_providers(pool).await?;
    let mut chosen: Option<(LlmProviderKind, String, String, String)> = None;
    let mut fallback: Option<(LlmProviderKind, String, String, String)> = None;

    for provider in &providers_tree {
        if !provider.enabled {
            continue;
        }
        for endpoint in &provider.endpoints {
            for model in &endpoint.models {
                let candidate = (
                    provider.kind,
                    endpoint.base_url.clone(),
                    endpoint.id.clone(),
                    model.model_id.clone(),
                );
                if Some(&model.id) == wanted_model_id.as_ref() {
                    chosen = Some(candidate);
                } else if model.is_default && fallback.is_none() {
                    fallback = Some(candidate);
                }
            }
        }
    }

    let (kind, base_url, endpoint_id, model_id) = chosen.or(fallback).ok_or_else(|| {
        AppError::validation(
            "No model is configured. Add a provider, endpoint, and model in LLM Setting first.",
        )
    })?;

    Ok(ResolvedTarget {
        kind,
        base_url,
        api_key: providers::read_api_key(app, &endpoint_id)?,
        model_id,
        system_prompt: assistant.system_prompt,
        enabled_tools: assistant.enabled_tools,
    })
}

/// Rebuilds the conversation the provider should see from stored messages.
///
/// Reads from `conversation_history`, which already drops everything before the
/// last context reset — going through `list_messages` here would resend turns the
/// user explicitly cleared.
pub fn history_to_turns(messages: &[ChatMessage]) -> Vec<Turn> {
    let mut turns = Vec::new();
    for message in messages {
        match message.role {
            ChatRole::User => {
                if let Some(text) = message.content.as_deref() {
                    turns.push(Turn::User {
                        text: text.to_string(),
                    });
                }
            }
            ChatRole::Assistant => {
                // An assistant row with neither text nor calls is an aborted
                // send; replaying it would confuse the model.
                if message.content.is_some() || !message.tool_calls.is_empty() {
                    turns.push(Turn::Assistant {
                        text: message.content.clone(),
                        tool_calls: message.tool_calls.clone(),
                    });
                }
                // Each call's result is its own turn, because both wire formats
                // require the result to reference the call it answers.
                for call in &message.tool_calls {
                    turns.push(tool_result_turn(call));
                }
            }
            // Tool rows are folded into the assistant turn above, and reset
            // markers never reach the model.
            ChatRole::Tool | ChatRole::ContextReset => {}
        }
    }
    turns
}

fn tool_result_turn(call: &ChatToolCall) -> Turn {
    let (content, is_error) = match (&call.result, &call.error) {
        (_, Some(error)) => (error.clone(), true),
        (Some(result), None) => (
            serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string()),
            false,
        ),
        (None, None) => ("(no output)".to_string(), false),
    };
    Turn::ToolResult {
        call_id: call.call_id.clone(),
        tool: call.tool.clone(),
        content: truncate_tool_output(&content),
        is_error,
    }
}

/// Caps a tool result, saying so in-band. Silent truncation would let the model
/// treat a partial log as complete.
pub fn truncate_tool_output(text: &str) -> String {
    if text.chars().count() <= MAX_TOOL_RESULT_CHARS {
        return text.to_string();
    }
    let kept: String = text.chars().take(MAX_TOOL_RESULT_CHARS).collect();
    format!("{kept}\n\n[truncated: the full result was too large to send]")
}

/// Filters advertised tools down to what an assistant may use.
pub fn allowed_tools(
    tools: Vec<ToolDefinition>,
    enabled: Option<&[String]>,
) -> Vec<ToolDefinition> {
    match enabled {
        None => tools,
        Some(enabled) => tools
            .into_iter()
            .filter(|tool| enabled.iter().any(|name| name == &tool.name))
            .collect(),
    }
}

/// Whether the round produced tool calls that must be run before continuing.
pub fn pending_calls(events: &[StreamEvent]) -> Vec<(String, String, String)> {
    events
        .iter()
        .filter_map(|event| match event {
            StreamEvent::ToolCall {
                call_id,
                tool,
                arguments,
            } => Some((call_id.clone(), tool.clone(), arguments.clone())),
            _ => None,
        })
        .collect()
}

/// Concatenated assistant text from one round.
pub fn collected_text(events: &[StreamEvent]) -> Option<String> {
    let text: String = events
        .iter()
        .filter_map(|event| match event {
            StreamEvent::TextDelta(delta) => Some(delta.as_str()),
            _ => None,
        })
        .collect();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    // A failed emit means the window is gone; the conversation still completes
    // and persists, so this is not worth failing the send over.
    let _ = app.emit(event, payload);
}

// --- The loop -------------------------------------------------------------

/// Runs one send to completion, for a conversation that uses its own model.
///
/// Thin wrapper over [`send_with_model`] with no per-send override, so ordinary
/// sends read the same way they always have.
pub async fn send(
    app: &AppHandle,
    pool: &SqlitePool,
    in_process: &crate::mcp::in_process::InProcessClient,
    session_id: &str,
    text: &str,
    cancel: tokio_util::sync::CancellationToken,
) -> AppResult<String> {
    send_with_model(app, pool, in_process, session_id, text, None, cancel).await
}

/// Runs one send to completion: persist the user turn, then alternate between
/// streaming a response and running the tools it asks for.
///
/// `model_override` switches the model for this single send — a regenerate on a
/// different model — without touching the session's stored choice.
///
/// Returns the assistant message id. Errors are both returned and recorded on the
/// assistant row, so a failed send leaves a visible trace in the transcript
/// rather than a silently missing reply.
pub async fn send_with_model(
    app: &AppHandle,
    pool: &SqlitePool,
    in_process: &crate::mcp::in_process::InProcessClient,
    session_id: &str,
    text: &str,
    model_override: Option<&str>,
    cancel: tokio_util::sync::CancellationToken,
) -> AppResult<String> {
    // Read before the user turn is stored: "no messages yet" is what marks this
    // as the first send, and appending would make it false.
    let needs_title = crate::db::chat::awaiting_first_title(pool, session_id).await?;

    crate::db::chat::append_message(
        pool,
        session_id,
        ChatRole::User,
        crate::db::chat::NewMessage::text(text),
    )
    .await?;

    // Naming runs alongside the answer rather than before it: the user is waiting
    // on the reply, not the title, and the two requests touch nothing in common.
    let (assistant_id, ()) = tokio::join!(
        answer_current_turn(app, pool, in_process, session_id, model_override, &cancel),
        async {
            if needs_title {
                name_session(app, pool, session_id, text, model_override, &cancel).await;
            }
        }
    );

    assistant_id
}

/// Creates an assistant placeholder and runs the answer loop against whatever
/// the last stored user turn is. Used by a plain send (after appending the user
/// turn) and by regenerate/edit (which re-answer an already-stored turn).
///
/// Persists the finished reply and streams its progress. Returns the assistant
/// message id.
pub async fn answer_current_turn(
    app: &AppHandle,
    pool: &SqlitePool,
    in_process: &crate::mcp::in_process::InProcessClient,
    session_id: &str,
    model_override: Option<&str>,
    cancel: &tokio_util::sync::CancellationToken,
) -> AppResult<String> {
    let started = Instant::now();
    let target = resolve_target(app, pool, session_id, model_override).await?;

    // Created before the first request so deltas have an id to attach to.
    let assistant = crate::db::chat::append_message(
        pool,
        session_id,
        ChatRole::Assistant,
        crate::db::chat::NewMessage {
            model_id: Some(&target.model_id),
            ..Default::default()
        },
    )
    .await?;

    let outcome = run_rounds(
        app,
        pool,
        in_process,
        session_id,
        &assistant.id,
        &target,
        cancel,
    )
    .await;

    let duration_ms = started.elapsed().as_millis() as i64;

    match outcome {
        Ok(RoundsOutcome {
            text,
            tool_calls,
            usage,
        }) => {
            crate::db::chat::finish_assistant_message(
                pool,
                &assistant.id,
                text.as_deref(),
                &tool_calls,
                Some(duration_ms),
                None,
            )
            .await?;
            emit(
                app,
                EVENT_DONE,
                DoneEvent {
                    session_id: session_id.to_string(),
                    message_id: assistant.id.clone(),
                    duration_ms,
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                },
            );
            Ok(assistant.id)
        }
        Err(error) => {
            let message = error.to_string();
            // Persist whatever was streamed alongside the error: a partial answer
            // plus its failure reason is more useful than an empty bubble.
            let _ = crate::db::chat::finish_assistant_message(
                pool,
                &assistant.id,
                None,
                &[],
                Some(duration_ms),
                Some(&message),
            )
            .await;
            emit(
                app,
                EVENT_ERROR,
                ErrorEvent {
                    session_id: session_id.to_string(),
                    message_id: assistant.id.clone(),
                    message,
                },
            );
            Err(error)
        }
    }
}

/// Names a still-unnamed conversation from its first message.
///
/// Deliberately infallible: a title is a convenience, so a naming request that
/// fails must not stop the answer the user actually asked for. The rename is
/// conditional in SQL, so a user renaming the session at the same moment wins.
async fn name_session(
    app: &AppHandle,
    pool: &SqlitePool,
    session_id: &str,
    first_message: &str,
    model_override: Option<&str>,
    cancel: &tokio_util::sync::CancellationToken,
) {
    let target = match resolve_target(app, pool, session_id, model_override).await {
        Ok(target) => target,
        // No model to name with yet is not worth failing the send over.
        Err(_) => return,
    };
    let title = super::title::generate(&target, first_message, cancel).await;
    match crate::db::chat::rename_if_untitled(pool, session_id, &title).await {
        Ok(true) => emit(
            app,
            EVENT_TITLE,
            TitleEvent {
                session_id: session_id.to_string(),
                title,
            },
        ),
        // False means the user renamed it first, which is not a problem.
        Ok(false) => {}
        Err(error) => crate::diagnostics::append_log_line(
            "WARN",
            &format!("Could not store the generated chat title: {error}"),
        ),
    }
}

struct RoundsOutcome {
    text: Option<String>,
    tool_calls: Vec<ChatToolCall>,
    usage: Usage,
}

/// Alternates streaming and tool execution until the model stops asking for
/// tools, or the round cap is hit.
async fn run_rounds(
    app: &AppHandle,
    pool: &SqlitePool,
    in_process: &crate::mcp::in_process::InProcessClient,
    session_id: &str,
    message_id: &str,
    target: &ResolvedTarget,
    cancel: &tokio_util::sync::CancellationToken,
) -> AppResult<RoundsOutcome> {
    let advertised = tool_definitions(app, in_process).await?;
    let tools = allowed_tools(advertised, target.enabled_tools.as_deref());

    let stored = crate::db::chat::conversation_history(pool, session_id).await?;
    let mut turns = history_to_turns(&stored);

    let mut all_text = String::new();
    let mut all_calls: Vec<ChatToolCall> = Vec::new();
    let mut usage = Usage::default();

    for round in 0..MAX_ROUNDS {
        if cancel.is_cancelled() {
            break;
        }

        let (events, round_usage) =
            stream_round(app, target, &tools, &turns, session_id, message_id, cancel).await?;
        if round_usage.input_tokens.is_some() {
            usage.input_tokens = round_usage.input_tokens;
        }
        if let Some(output) = round_usage.output_tokens {
            // Output accumulates across rounds; input is the last prompt's size.
            usage.output_tokens = Some(usage.output_tokens.unwrap_or(0) + output);
        }

        let round_text = collected_text(&events);
        if let Some(text) = &round_text {
            all_text.push_str(text);
        }

        let calls = pending_calls(&events);
        if calls.is_empty() {
            // The model answered without asking for anything more.
            return Ok(RoundsOutcome {
                text: (!all_text.is_empty()).then(|| all_text.clone()),
                tool_calls: all_calls,
                usage,
            });
        }

        let executed = run_tools(
            app,
            in_process,
            session_id,
            message_id,
            &calls,
            cancel,
        )
        .await;

        turns.push(Turn::Assistant {
            text: round_text,
            tool_calls: executed.clone(),
        });
        for call in &executed {
            turns.push(tool_result_turn(call));
        }
        all_calls.extend(executed);

        if round + 1 == MAX_ROUNDS {
            return Err(AppError::internal(format!(
                "Stopped after {MAX_ROUNDS} tool rounds without a final answer. Ask a narrower question, or check the tool results above."
            )));
        }
    }

    Ok(RoundsOutcome {
        text: (!all_text.is_empty()).then_some(all_text),
        tool_calls: all_calls,
        usage,
    })
}

/// One provider round-trip, streaming text deltas to the UI as they arrive.
async fn stream_round(
    app: &AppHandle,
    target: &ResolvedTarget,
    tools: &[ToolDefinition],
    turns: &[Turn],
    session_id: &str,
    message_id: &str,
    cancel: &tokio_util::sync::CancellationToken,
) -> AppResult<(Vec<StreamEvent>, Usage)> {
    let mut events = Vec::new();
    let system_prompt = target.system_prompt.as_deref();

    let on_event = |event: StreamEvent| {
        if let StreamEvent::TextDelta(text) = &event {
            emit(
                app,
                EVENT_DELTA,
                DeltaEvent {
                    session_id: session_id.to_string(),
                    message_id: message_id.to_string(),
                    text: text.clone(),
                },
            );
        }
        events.push(event);
    };

    let usage = match target.kind {
        LlmProviderKind::Openai => {
            let body =
                super::openai::build_request(&target.model_id, system_prompt, tools, turns);
            super::openai::stream_response(
                &target.base_url,
                &target.api_key,
                &body,
                cancel,
                on_event,
            )
            .await?
        }
        LlmProviderKind::Anthropic => {
            let body = super::anthropic::build_request(
                &target.model_id,
                system_prompt,
                tools,
                turns,
                None,
            );
            super::anthropic::stream_response(
                &target.base_url,
                &target.api_key,
                &body,
                cancel,
                on_event,
            )
            .await?
        }
    };

    Ok((events, usage))
}

/// Runs each requested tool through the in-process MCP client, reporting start
/// and end to the UI.
///
/// Tools are read-only AWS queries, so they run without asking the user — but
/// every call is emitted and every call is audited, so nothing happens invisibly.
async fn run_tools(
    app: &AppHandle,
    in_process: &crate::mcp::in_process::InProcessClient,
    session_id: &str,
    message_id: &str,
    calls: &[(String, String, String)],
    cancel: &tokio_util::sync::CancellationToken,
) -> Vec<ChatToolCall> {
    let mut executed = Vec::with_capacity(calls.len());

    for (call_id, tool, arguments) in calls {
        if cancel.is_cancelled() {
            break;
        }

        // Malformed arguments are reported to the model as a tool error rather
        // than aborting: it can correct itself on the next round.
        let args = match parse_tool_arguments(arguments) {
            Ok(args) => args,
            Err(message) => {
                let call = ChatToolCall {
                    call_id: call_id.clone(),
                    tool: tool.clone(),
                    args: serde_json::json!({"raw": arguments}),
                    result: None,
                    error: Some(message.clone()),
                    duration_ms: Some(0),
                };
                emit_tool_end(app, session_id, message_id, &call);
                executed.push(call);
                continue;
            }
        };

        emit(
            app,
            EVENT_TOOL,
            ToolEvent {
                session_id: session_id.to_string(),
                message_id: message_id.to_string(),
                call_id: call_id.clone(),
                tool: tool.clone(),
                args: args.clone(),
                phase: "start",
                duration_ms: None,
                result: None,
                error: None,
            },
        );

        let started = Instant::now();
        let outcome = call_tool(app, in_process, tool, &args).await;
        let duration_ms = started.elapsed().as_millis() as i64;

        let call = match outcome {
            Ok(result) => ChatToolCall {
                call_id: call_id.clone(),
                tool: tool.clone(),
                args,
                result: Some(result),
                error: None,
                duration_ms: Some(duration_ms),
            },
            Err(error) => ChatToolCall {
                call_id: call_id.clone(),
                tool: tool.clone(),
                args,
                result: None,
                error: Some(error),
                duration_ms: Some(duration_ms),
            },
        };

        emit_tool_end(app, session_id, message_id, &call);
        executed.push(call);
    }

    executed
}

fn emit_tool_end(app: &AppHandle, session_id: &str, message_id: &str, call: &ChatToolCall) {
    emit(
        app,
        EVENT_TOOL,
        ToolEvent {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            call_id: call.call_id.clone(),
            tool: call.tool.clone(),
            args: call.args.clone(),
            phase: "end",
            duration_ms: call.duration_ms,
            result: call.result.clone(),
            error: call.error.clone(),
        },
    );
}

/// Invokes one tool over the in-process transport and normalises its output.
async fn call_tool(
    app: &AppHandle,
    in_process: &crate::mcp::in_process::InProcessClient,
    tool: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let guard = in_process.ensure(app.clone()).await?;

    // `CallToolRequestParams` is non-exhaustive, so it is built through its
    // constructor rather than a struct literal.
    let mut params = rmcp::model::CallToolRequestParams::new(tool.to_string());
    if let Some(arguments) = args.as_object().cloned() {
        params = params.with_arguments(arguments);
    }

    let result = guard
        .client()
        .call_tool(params)
        .await
        .map_err(|error| format!("tool {tool} failed: {error}"))?;

    if result.is_error.unwrap_or(false) {
        return Err(tool_text(&result));
    }

    // Structured output when the tool publishes a schema, else its text content.
    if let Some(structured) = result.structured_content {
        return Ok(structured);
    }
    let text = tool_text(&result);
    // The tools return JSON as text; parsing it keeps the audit row and the UI
    // step showing structure rather than an escaped blob.
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text)))
}

fn tool_text(result: &rmcp::model::CallToolResult) -> String {
    result
        .content
        .iter()
        .filter_map(|block| block.as_text().map(|text| text.text.as_str()))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The tools the MCP server advertises, in provider-neutral form.
async fn tool_definitions(
    app: &AppHandle,
    in_process: &crate::mcp::in_process::InProcessClient,
) -> AppResult<Vec<ToolDefinition>> {
    let tools = in_process
        .list_tools(app.clone())
        .await
        .map_err(AppError::internal)?;
    Ok(tools
        .into_iter()
        .map(|tool| ToolDefinition {
            name: tool.name.to_string(),
            description: tool.description.map(|text| text.to_string()),
            input_schema: serde_json::to_value(&*tool.input_schema)
                .unwrap_or_else(|_| serde_json::json!({"type": "object"})),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn message(role: ChatRole, content: Option<&str>, calls: Vec<ChatToolCall>) -> ChatMessage {
        ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: "s1".to_string(),
            seq: 0,
            role,
            content: content.map(ToString::to_string),
            tool_calls: calls,
            model_id: None,
            duration_ms: None,
            error: None,
            created_at: Utc::now(),
        }
    }

    fn call(call_id: &str, result: Option<serde_json::Value>, error: Option<&str>) -> ChatToolCall {
        ChatToolCall {
            call_id: call_id.to_string(),
            tool: "find_job".to_string(),
            args: serde_json::json!({"jobId": "abc"}),
            result,
            error: error.map(ToString::to_string),
            duration_ms: Some(10),
        }
    }

    fn tool(name: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_string(),
            description: None,
            input_schema: serde_json::json!({"type": "object"}),
        }
    }

    #[test]
    fn a_plain_exchange_becomes_user_and_assistant_turns() {
        let turns = history_to_turns(&[
            message(ChatRole::User, Some("why did it fail?"), vec![]),
            message(ChatRole::Assistant, Some("out of memory"), vec![]),
        ]);

        assert_eq!(turns.len(), 2);
        assert!(matches!(&turns[0], Turn::User { text } if text == "why did it fail?"));
        assert!(matches!(
            &turns[1],
            Turn::Assistant { text, tool_calls } if text.as_deref() == Some("out of memory") && tool_calls.is_empty()
        ));
    }

    #[test]
    fn each_tool_call_gains_its_own_result_turn() {
        let turns = history_to_turns(&[message(
            ChatRole::Assistant,
            Some("checking"),
            vec![
                call("c1", Some(serde_json::json!({"found": true})), None),
                call("c2", None, Some("job not found")),
            ],
        )]);

        // One assistant turn carrying both calls, then one result turn each —
        // both wire formats need the result to reference its call.
        assert_eq!(turns.len(), 3);
        assert!(matches!(&turns[0], Turn::Assistant { tool_calls, .. } if tool_calls.len() == 2));
        assert!(matches!(
            &turns[1],
            Turn::ToolResult { call_id, content, is_error, .. }
                if call_id == "c1" && content.contains("found") && !is_error
        ));
        // A failure is reported to the model, not hidden, so it can retry.
        assert!(matches!(
            &turns[2],
            Turn::ToolResult { call_id, content, is_error, .. }
                if call_id == "c2" && content == "job not found" && *is_error
        ));
    }

    #[test]
    fn context_reset_markers_never_reach_the_model() {
        // conversation_history already truncates; this guards the belt-and-braces
        // case of a marker still being present in the slice.
        let turns = history_to_turns(&[
            message(ChatRole::ContextReset, None, vec![]),
            message(ChatRole::User, Some("fresh start"), vec![]),
        ]);

        assert_eq!(turns.len(), 1);
        assert!(matches!(&turns[0], Turn::User { text } if text == "fresh start"));
    }

    #[test]
    fn an_aborted_assistant_row_is_skipped() {
        // A send that failed before streaming anything leaves a row with neither
        // text nor calls; replaying it would confuse the model.
        let turns = history_to_turns(&[message(ChatRole::Assistant, None, vec![])]);
        assert!(turns.is_empty());
    }

    #[test]
    fn a_tool_call_without_output_still_produces_a_result_turn() {
        // The wire formats require an answer for every call, even an empty one.
        let turns = history_to_turns(&[message(
            ChatRole::Assistant,
            None,
            vec![call("c1", None, None)],
        )]);
        assert_eq!(turns.len(), 2);
        assert!(matches!(
            &turns[1],
            Turn::ToolResult { content, is_error, .. } if content == "(no output)" && !is_error
        ));
    }

    #[test]
    fn tool_output_is_capped_with_an_explicit_marker() {
        let short = truncate_tool_output("small");
        assert_eq!(short, "small");

        let long = "x".repeat(MAX_TOOL_RESULT_CHARS + 500);
        let capped = truncate_tool_output(&long);
        assert!(capped.len() < long.len() + 100);
        // Silent truncation would let the model treat a partial log as whole.
        assert!(capped.contains("[truncated"), "{}", &capped[..80]);
    }

    #[test]
    fn an_assistant_restricted_to_some_tools_only_sees_those() {
        let advertised = vec![
            tool("find_job"),
            tool("analyze_job_failure"),
            tool("get_job_log_text"),
        ];

        let restricted = allowed_tools(advertised.clone(), Some(&["find_job".to_string()]));
        assert_eq!(restricted.len(), 1);
        assert_eq!(restricted[0].name, "find_job");

        // None means every tool, which is the built-in assistant's setting.
        assert_eq!(allowed_tools(advertised, None).len(), 3);
    }

    #[test]
    fn an_unknown_tool_name_in_the_restriction_is_ignored() {
        let restricted = allowed_tools(
            vec![tool("find_job")],
            Some(&["find_job".to_string(), "removed_tool".to_string()]),
        );
        assert_eq!(restricted.len(), 1);
    }

    #[test]
    fn a_restriction_matching_nothing_advertises_no_tools() {
        let restricted = allowed_tools(vec![tool("find_job")], Some(&[]));
        assert!(restricted.is_empty());
    }

    #[test]
    fn text_and_calls_are_read_out_of_a_rounds_events() {
        let events = vec![
            StreamEvent::TextDelta("Check".to_string()),
            StreamEvent::TextDelta("ing".to_string()),
            StreamEvent::ToolCall {
                call_id: "c1".to_string(),
                tool: "find_job".to_string(),
                arguments: "{\"jobId\":\"abc\"}".to_string(),
            },
            StreamEvent::Done {
                stop_reason: Some("tool_calls".to_string()),
            },
        ];

        assert_eq!(collected_text(&events).as_deref(), Some("Checking"));
        assert_eq!(
            pending_calls(&events),
            vec![(
                "c1".to_string(),
                "find_job".to_string(),
                "{\"jobId\":\"abc\"}".to_string()
            )]
        );
    }

    #[test]
    fn a_round_with_no_calls_ends_the_loop() {
        let events = vec![
            StreamEvent::TextDelta("done".to_string()),
            StreamEvent::Done {
                stop_reason: Some("stop".to_string()),
            },
        ];
        assert!(pending_calls(&events).is_empty());
    }

    #[test]
    fn a_round_with_no_text_reports_none_rather_than_empty() {
        let events = vec![StreamEvent::Done { stop_reason: None }];
        assert_eq!(collected_text(&events), None);
    }
}
