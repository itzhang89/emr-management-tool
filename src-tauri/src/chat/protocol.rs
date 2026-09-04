//! The provider-shape abstraction the chat loop is written against.
//!
//! One conversation, three wire formats. Everything above this module works in
//! terms of `Turn` / `StreamEvent` / `ToolDefinition`; `openai.rs`,
//! `anthropic.rs`, and `gemini.rs` translate to and from their own JSON.

use crate::error::AppError;
use crate::models::ChatToolCall;
use std::time::Duration;

/// Error code marking a response that means "this API key is no good", as
/// opposed to "this request was bad".
///
/// It travels on the error rather than being re-derived from a status further
/// up, so the one place that knows an HTTP code was 401 is the place that saw
/// it. `chat::providers::error_retires_key` is what reads it.
pub const AUTH_REJECTED_CODE: &str = "LlmAuthRejected";

/// Ceiling on establishing the connection. A gateway that does not answer the
/// handshake is unreachable, and waiting on it indefinitely is what made the
/// stop button look broken.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Ceiling on the gap *between* bytes, not on the whole response.
///
/// A long answer with several tool rounds legitimately streams for minutes, so a
/// total timeout would cut off working conversations. What is never normal is a
/// connection that goes quiet for two minutes mid-stream — that is a dead socket,
/// and without this the read simply hangs.
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(120);

/// The HTTP client every streaming protocol module uses.
///
/// Shared so all three shapes get the same timeout policy: a hung provider must
/// not depend on which one the user picked.
pub fn streaming_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_IDLE_TIMEOUT)
        .build()
        .map_err(|error| AppError::internal(error.to_string()))
}

/// Runs `future` unless the token fires first, in which case it is dropped.
///
/// Every await on the send path goes through this. Checking the token only
/// between steps is not enough: the request that establishes the stream can hang
/// for as long as the provider keeps the socket open, and during that await a
/// cancelled token was previously invisible — the stop button set it, the command
/// returned success, and nothing ever observed it.
///
/// `None` means cancelled. Dropping is how both `reqwest` and `rmcp` requests are
/// aborted; neither leaves shared state behind.
pub async fn until_cancelled<T>(
    cancel: &tokio_util::sync::CancellationToken,
    future: impl std::future::Future<Output = T>,
) -> Option<T> {
    tokio::select! {
        // Biased so an already-cancelled token wins even when the future is
        // immediately ready, making "stopped" unambiguous.
        biased;
        _ = cancel.cancelled() => None,
        value = future => Some(value),
    }
}

/// Error code marking work the user stopped, as opposed to work that failed.
pub const CANCELLED_CODE: &str = "LlmCancelled";

/// The error for an interrupted step. Kept distinguishable so the transcript can
/// say "stopped" rather than reporting a failure the user caused deliberately.
pub fn cancelled() -> AppError {
    let mut error = AppError::validation("Stopped.");
    error.code = CANCELLED_CODE.into();
    error
}

pub fn is_cancelled(error: &AppError) -> bool {
    error.code.as_ref() == CANCELLED_CODE
}

/// Turns a non-2xx response into an `AppError`, tagging the auth failures so a
/// caller holding several API keys can retire the one it used and try the next.
///
/// 429 is deliberately *not* tagged: being rate limited proves the key works.
pub fn http_failure(status: u16, message: String) -> AppError {
    let mut error = AppError::validation(message);
    if matches!(status, 401 | 403) {
        error.code = AUTH_REJECTED_CODE.into();
    }
    error
}

/// Pulls the provider's own message and code out of an error body. The three
/// shapes nest differently (`error.error.message` on Anthropic, `error.message`
/// elsewhere), so a few paths are tried. Returns `(message, code)`.
pub fn envelope_fields(body: &str) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return (None, None);
    };
    let error = value.get("error");
    let message = error
        .and_then(|inner| inner.get("error"))
        .and_then(|inner| inner.get("message"))
        .and_then(|message| message.as_str())
        .or_else(|| error.and_then(|inner| inner.get("message")).and_then(|m| m.as_str()))
        .or_else(|| value.get("message").and_then(|m| m.as_str()))
        .map(|message| message.chars().take(300).collect::<String>());
    let code = error
        .and_then(|inner| inner.get("code"))
        .or_else(|| error.and_then(|inner| inner.get("status")))
        .or_else(|| error.and_then(|inner| inner.get("type")))
        .and_then(|code| {
            code.as_str()
                .map(ToString::to_string)
                .or_else(|| code.as_i64().map(|number| number.to_string()))
        });
    (message, code)
}

/// Assembles the structured diagnostics the transcript shows behind a failed
/// reply. The API key is never included — it travels in a header, not the body —
/// and response text is capped so a verbose provider cannot bloat the stored row.
pub fn request_details(
    method: &str,
    url: &str,
    request_body: Option<&serde_json::Value>,
    http_status: Option<u16>,
    response_body: Option<&str>,
    error_kind: &str,
    provider_reason: Option<String>,
    error_code: Option<String>,
    stack: Option<String>,
) -> crate::error::ErrorDetails {
    crate::error::ErrorDetails {
        url: Some(url.to_string()),
        method: Some(method.to_string()),
        http_status,
        request_body: request_body.cloned(),
        response_body: response_body.and_then(|body| crate::error::capped(body, 8_000)),
        provider_reason,
        error_code,
        error_kind: Some(error_kind.to_string()),
        stack,
    }
}

/// An error envelope the provider sent *mid-stream* (HTTP 200), carried by the
/// folder up to `stream_response`, which owns the request context.
#[derive(Debug, Clone)]
pub struct StreamErrorPayload {
    pub message: String,
    pub error_code: Option<String>,
    pub error_kind: Option<String>,
    /// The raw provider error object, kept for the response body.
    pub raw: Option<serde_json::Value>,
}

/// Turns a mid-stream error envelope into an `AppError` with diagnostics.
pub fn stream_error(
    url: &str,
    request_body: Option<&serde_json::Value>,
    payload: &StreamErrorPayload,
) -> AppError {
    let response_body = payload
        .raw
        .as_ref()
        .map(|raw| raw.to_string())
        .as_deref()
        .and_then(|body| crate::error::capped(body, 8_000));
    let details = crate::error::ErrorDetails {
        url: Some(url.to_string()),
        method: Some("POST".to_string()),
        http_status: None,
        request_body: request_body.cloned(),
        response_body,
        provider_reason: Some(payload.message.clone()),
        error_code: payload.error_code.clone(),
        error_kind: Some(payload.error_kind.clone().unwrap_or_else(|| "stream".to_string())),
        stack: None,
    };
    AppError::validation(format!(
        "The provider stopped the response: {}",
        payload.message
    ))
    .with_details(details)
}

/// A tool the model may call, in provider-neutral form. Built from the MCP
/// server's advertised tools.
#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: Option<String>,
    /// JSON Schema for the arguments.
    pub input_schema: serde_json::Value,
}

/// One entry of conversation history sent to the model.
///
/// A tool result is its own turn rather than part of the assistant turn, because
/// both shapes require the result to reference the call it answers.
#[derive(Debug, Clone)]
pub enum Turn {
    User {
        text: String,
    },
    /// What the model said, plus any calls it asked for.
    Assistant {
        text: Option<String>,
        tool_calls: Vec<ChatToolCall>,
    },
    ToolResult {
        call_id: String,
        tool: String,
        /// Serialized tool output, or the error text when the call failed. The
        /// model is told about failures rather than having them hidden, so it can
        /// retry differently instead of inventing an answer.
        content: String,
        is_error: bool,
    },
}

/// What one streamed response produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEvent {
    /// A chunk of assistant text to append.
    TextDelta(String),
    /// A complete tool call the model asked for. Emitted once its arguments have
    /// finished streaming, so the caller never sees partial JSON.
    ToolCall {
        call_id: String,
        tool: String,
        arguments: String,
        /// Opaque token to echo back with this call — see
        /// `ChatToolCall::signature`. Only Gemini mints these.
        signature: Option<String>,
    },
    /// The response ended. `stop_reason` is the provider's own wording, kept for
    /// diagnostics rather than control flow.
    Done { stop_reason: Option<String> },
}

/// Token usage, when the provider reports it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

/// Accumulates tool-call fragments while they stream.
///
/// OpenAI streams a call's name and arguments across many deltas addressed by
/// index; Anthropic streams them addressed by content-block index. Both need the
/// same "collect until the block ends" behaviour, so it lives here once.
#[derive(Debug, Default)]
pub struct ToolCallAccumulator {
    slots: Vec<ToolCallSlot>,
}

#[derive(Debug, Default, Clone)]
struct ToolCallSlot {
    call_id: String,
    tool: String,
    arguments: String,
}

impl ToolCallAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a fragment. Any of the three parts may arrive in any delta, and
    /// missing parts leave what was already collected untouched.
    pub fn push(
        &mut self,
        index: usize,
        call_id: Option<&str>,
        tool: Option<&str>,
        arguments_fragment: Option<&str>,
    ) {
        if self.slots.len() <= index {
            self.slots.resize(index + 1, ToolCallSlot::default());
        }
        let slot = &mut self.slots[index];
        if let Some(call_id) = call_id {
            if !call_id.is_empty() {
                slot.call_id = call_id.to_string();
            }
        }
        if let Some(tool) = tool {
            if !tool.is_empty() {
                slot.tool = tool.to_string();
            }
        }
        if let Some(fragment) = arguments_fragment {
            slot.arguments.push_str(fragment);
        }
    }

    /// Takes one finished call, for shapes that signal per-block completion.
    pub fn take(&mut self, index: usize) -> Option<StreamEvent> {
        let slot = self.slots.get_mut(index)?;
        if slot.tool.is_empty() {
            return None;
        }
        let slot = std::mem::take(slot);
        Some(finished(slot))
    }

    /// Takes every collected call, for shapes that only signal end-of-response.
    pub fn take_all(&mut self) -> Vec<StreamEvent> {
        std::mem::take(&mut self.slots)
            .into_iter()
            .filter(|slot| !slot.tool.is_empty())
            .map(finished)
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.iter().all(|slot| slot.tool.is_empty())
    }
}

fn finished(slot: ToolCallSlot) -> StreamEvent {
    StreamEvent::ToolCall {
        // A provider that omits an id still needs one to correlate the result.
        call_id: if slot.call_id.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            slot.call_id
        },
        tool: slot.tool,
        // An argument-less call streams nothing; the tools accept `{}`.
        arguments: if slot.arguments.trim().is_empty() {
            "{}".to_string()
        } else {
            slot.arguments
        },
        // Only Gemini mints signatures, and it does not stream calls in fragments,
        // so nothing that reaches this accumulator ever has one.
        signature: None,
    }
}

/// Parses accumulated argument text into a JSON object.
///
/// A model can emit malformed JSON. Rather than aborting the conversation, the
/// caller surfaces the parse failure to the model as a tool error so it can try
/// again — which is why this returns a message rather than panicking.
pub fn parse_tool_arguments(arguments: &str) -> Result<serde_json::Value, String> {
    let trimmed = arguments.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::json!({}));
    }
    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(value) if value.is_object() => Ok(value),
        Ok(_) => Err("tool arguments must be a JSON object".to_string()),
        Err(error) => Err(format!("tool arguments were not valid JSON: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_already_cancelled_token_wins_over_a_ready_future() {
        // The select is biased for exactly this: a stop pressed while a request was
        // completing must read as stopped, not as a success the user did not see.
        let token = tokio_util::sync::CancellationToken::new();
        token.cancel();
        assert_eq!(until_cancelled(&token, async { 1 }).await, None);
    }

    #[tokio::test]
    async fn a_future_that_finishes_first_returns_its_value() {
        let token = tokio_util::sync::CancellationToken::new();
        assert_eq!(until_cancelled(&token, async { 7 }).await, Some(7));
    }

    #[tokio::test]
    async fn a_hanging_future_is_abandoned_when_the_token_fires() {
        // This is the shape of the bug: a request the provider never answers. It
        // has to be abandoned rather than awaited forever.
        let token = tokio_util::sync::CancellationToken::new();
        let fire = token.clone();
        tokio::spawn(async move {
            tokio::task::yield_now().await;
            fire.cancel();
        });

        let outcome = until_cancelled(&token, std::future::pending::<()>()).await;
        assert_eq!(outcome, None);
    }

    #[test]
    fn stopping_is_distinguishable_from_failing() {
        let stopped = cancelled();
        assert!(is_cancelled(&stopped));
        // The transcript reads this, so it must not look like a provider error.
        assert_eq!(stopped.message.as_ref(), "Stopped.");

        assert!(!is_cancelled(&AppError::internal("dns failure")));
        assert!(!is_cancelled(&http_failure(401, "bad key".to_string())));
    }

    #[test]
    fn the_streaming_client_builds_with_a_timeout_policy() {
        // A client with no timeouts is what let a quiet socket hang forever.
        assert!(streaming_client().is_ok());
    }

    #[test]
    fn auth_failures_are_tagged_so_a_key_can_be_retired() {
        assert_eq!(
            http_failure(401, "bad key".to_string()).code.as_ref(),
            AUTH_REJECTED_CODE
        );
        assert_eq!(
            http_failure(403, "forbidden".to_string()).code.as_ref(),
            AUTH_REJECTED_CODE
        );
        // Rate limiting proves the key works, so it must not retire it.
        assert_ne!(
            http_failure(429, "slow down".to_string()).code.as_ref(),
            AUTH_REJECTED_CODE
        );
        assert_ne!(
            http_failure(500, "oops".to_string()).code.as_ref(),
            AUTH_REJECTED_CODE
        );
    }

    #[test]
    fn the_failure_message_is_preserved_verbatim() {
        assert_eq!(
            http_failure(401, "Authentication failed (401).".to_string())
                .message
                .as_ref(),
            "Authentication failed (401)."
        );
    }

    #[test]
    fn assembles_a_call_from_fragments() {
        let mut acc = ToolCallAccumulator::new();
        acc.push(0, Some("call_1"), Some("find_job"), Some("{\"jobId\""));
        acc.push(0, None, None, Some(":\"abc\"}"));

        assert_eq!(
            acc.take_all(),
            vec![StreamEvent::ToolCall {
                call_id: "call_1".to_string(),
                tool: "find_job".to_string(),
                arguments: "{\"jobId\":\"abc\"}".to_string(),
                signature: None
            }]
        );
    }

    #[test]
    fn keeps_parallel_calls_apart_by_index() {
        let mut acc = ToolCallAccumulator::new();
        acc.push(0, Some("c0"), Some("find_job"), Some("{}"));
        acc.push(1, Some("c1"), Some("describe_job"), Some("{\"a\":1}"));

        let calls = acc.take_all();
        assert_eq!(calls.len(), 2);
        assert!(matches!(
            &calls[0],
            StreamEvent::ToolCall { tool, .. } if tool == "find_job"
        ));
        assert!(matches!(
            &calls[1],
            StreamEvent::ToolCall { tool, .. } if tool == "describe_job"
        ));
    }

    #[test]
    fn a_late_index_does_not_lose_earlier_slots() {
        let mut acc = ToolCallAccumulator::new();
        // Anthropic numbers by content block, so index 0 may be text and the
        // first tool call may land at 2.
        acc.push(2, Some("c2"), Some("get_job_log_text"), Some("{}"));
        assert_eq!(acc.take_all().len(), 1);
    }

    #[test]
    fn takes_one_finished_call_without_disturbing_the_rest() {
        let mut acc = ToolCallAccumulator::new();
        acc.push(0, Some("c0"), Some("find_job"), Some("{}"));
        acc.push(1, Some("c1"), Some("describe_job"), Some("{}"));

        let first = acc.take(0).expect("first call is complete");
        assert!(matches!(first, StreamEvent::ToolCall { tool, .. } if tool == "find_job"));
        // The slot is consumed, so a later take_all does not re-emit it.
        assert_eq!(acc.take_all().len(), 1);
    }

    #[test]
    fn slots_without_a_tool_name_are_not_emitted() {
        let mut acc = ToolCallAccumulator::new();
        // Arguments arriving before the name is known must not produce a call.
        acc.push(0, None, None, Some("{\"a\":1}"));
        assert!(acc.is_empty());
        assert!(acc.take(0).is_none());
        assert!(acc.take_all().is_empty());
    }

    #[test]
    fn a_missing_call_id_is_generated() {
        let mut acc = ToolCallAccumulator::new();
        acc.push(0, None, Some("find_job"), Some("{}"));
        let calls = acc.take_all();
        assert!(matches!(
            &calls[0],
            StreamEvent::ToolCall { call_id, .. } if !call_id.is_empty()
        ));
    }

    #[test]
    fn an_argument_less_call_defaults_to_an_empty_object() {
        let mut acc = ToolCallAccumulator::new();
        acc.push(0, Some("c0"), Some("list_accounts"), None);
        assert_eq!(
            acc.take_all(),
            vec![StreamEvent::ToolCall {
                call_id: "c0".to_string(),
                tool: "list_accounts".to_string(),
                arguments: "{}".to_string(),
                signature: None
            }]
        );
    }

    #[test]
    fn tool_arguments_must_parse_to_an_object() {
        assert_eq!(
            parse_tool_arguments("{\"jobId\":\"abc\"}").unwrap(),
            serde_json::json!({"jobId": "abc"})
        );
        assert_eq!(parse_tool_arguments("  ").unwrap(), serde_json::json!({}));
        assert!(parse_tool_arguments("[1,2]").is_err());
        assert!(parse_tool_arguments("{oops").is_err());
    }
}
