//! Anthropic-shaped messages over SSE.
//!
//! Differences from the OpenAI shape that drive this module's structure:
//! the system prompt is a top-level field rather than a message; tool calls are
//! content blocks whose arguments stream as `input_json_delta`; a block ends with
//! an explicit `content_block_stop`; and `max_tokens` is required.

use super::protocol::{StreamEvent, ToolCallAccumulator, ToolDefinition, Turn, Usage};
use crate::error::{AppError, AppResult};
use serde_json::json;

/// Required by the API, so it needs a value even when the caller has no opinion.
/// Generous enough for a long failure analysis without being unbounded.
const DEFAULT_MAX_TOKENS: i64 = 8192;

pub fn build_request(
    model: &str,
    system_prompt: Option<&str>,
    tools: &[ToolDefinition],
    history: &[Turn],
    max_tokens: Option<i64>,
) -> serde_json::Value {
    let mut messages: Vec<serde_json::Value> = Vec::new();
    for turn in history {
        append_turn(&mut messages, turn);
    }

    let mut body = json!({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        "stream": true,
    });
    // The system prompt is a top-level field here, not a message.
    if let Some(system_prompt) = system_prompt.filter(|text| !text.trim().is_empty()) {
        body["system"] = json!(system_prompt);
    }
    if !tools.is_empty() {
        body["tools"] = serde_json::Value::Array(
            tools
                .iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.input_schema,
                    })
                })
                .collect(),
        );
    }
    body
}

fn append_turn(messages: &mut Vec<serde_json::Value>, turn: &Turn) {
    match turn {
        Turn::User { text } => {
            messages.push(json!({ "role": "user", "content": text }));
        }
        Turn::Assistant { text, tool_calls } => {
            let mut blocks: Vec<serde_json::Value> = Vec::new();
            if let Some(text) = text.as_deref().filter(|text| !text.is_empty()) {
                blocks.push(json!({ "type": "text", "text": text }));
            }
            for call in tool_calls {
                blocks.push(json!({
                    "type": "tool_use",
                    "id": call.call_id,
                    "name": call.tool,
                    // Unlike the OpenAI shape, input is a JSON object here.
                    "input": call.args,
                }));
            }
            // An assistant turn with no content at all is not representable;
            // skipping it keeps the alternation valid.
            if !blocks.is_empty() {
                messages.push(json!({ "role": "assistant", "content": blocks }));
            }
        }
        Turn::ToolResult {
            call_id,
            content,
            is_error,
            ..
        } => {
            // Tool results are user-role content blocks referencing the call.
            messages.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": content,
                    "is_error": is_error,
                }],
            }));
        }
    }
}

/// Folds SSE events into provider-neutral stream events.
///
/// Unlike the OpenAI shape, events are named and tool-call arguments arrive as
/// `input_json_delta` fragments inside a block that closes explicitly, so the
/// folder tracks which block index is currently a tool call.
#[derive(Debug, Default)]
pub struct StreamFolder {
    calls: ToolCallAccumulator,
    usage: Usage,
    finished: bool,
}

impl StreamFolder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn usage(&self) -> Usage {
        self.usage
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }

    /// Handles one named SSE event.
    pub fn push_event(&mut self, name: Option<&str>, payload: &str) -> Vec<StreamEvent> {
        let Ok(data) = serde_json::from_str::<serde_json::Value>(payload) else {
            return Vec::new();
        };
        // The `type` field inside the payload is authoritative; the `event:` line
        // repeats it, and some proxies drop the line.
        let event_type = data
            .get("type")
            .and_then(|t| t.as_str())
            .or(name)
            .unwrap_or_default();

        match event_type {
            "content_block_start" => self.on_block_start(&data),
            "content_block_delta" => self.on_block_delta(&data),
            "content_block_stop" => self.on_block_stop(&data),
            "message_delta" => self.on_message_delta(&data),
            "message_stop" => self.finish(None),
            "message_start" => {
                self.capture_usage(data.get("message").and_then(|m| m.get("usage")));
                Vec::new()
            }
            // An in-stream error is reported as an event rather than an HTTP
            // status, so it must not be silently swallowed.
            "error" => {
                let message = data
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(|message| message.as_str())
                    .unwrap_or("the provider reported a streaming error");
                self.finish(Some(format!("error: {message}")))
            }
            _ => Vec::new(),
        }
    }

    fn on_block_start(&mut self, data: &serde_json::Value) -> Vec<StreamEvent> {
        let index = block_index(data);
        let block = data.get("content_block");
        if block.and_then(|b| b.get("type")).and_then(|t| t.as_str()) == Some("tool_use") {
            self.calls.push(
                index,
                block.and_then(|b| b.get("id")).and_then(|id| id.as_str()),
                block.and_then(|b| b.get("name")).and_then(|n| n.as_str()),
                None,
            );
        }
        Vec::new()
    }

    fn on_block_delta(&mut self, data: &serde_json::Value) -> Vec<StreamEvent> {
        let index = block_index(data);
        let delta = data.get("delta");
        let delta_type = delta
            .and_then(|d| d.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or_default();

        match delta_type {
            "text_delta" => delta
                .and_then(|d| d.get("text"))
                .and_then(|text| text.as_str())
                .filter(|text| !text.is_empty())
                .map(|text| vec![StreamEvent::TextDelta(text.to_string())])
                .unwrap_or_default(),
            "input_json_delta" => {
                let fragment = delta
                    .and_then(|d| d.get("partial_json"))
                    .and_then(|json| json.as_str());
                self.calls.push(index, None, None, fragment);
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    /// A tool-use block closing means its arguments are complete, so the call can
    /// be emitted immediately rather than waiting for the message to end.
    fn on_block_stop(&mut self, data: &serde_json::Value) -> Vec<StreamEvent> {
        self.calls
            .take(block_index(data))
            .map(|event| vec![event])
            .unwrap_or_default()
    }

    fn on_message_delta(&mut self, data: &serde_json::Value) -> Vec<StreamEvent> {
        self.capture_usage(data.get("usage"));
        let stop_reason = data
            .get("delta")
            .and_then(|delta| delta.get("stop_reason"))
            .and_then(|reason| reason.as_str())
            .map(ToString::to_string);
        // message_delta carries the stop reason but the stream continues until
        // message_stop, so this only records it.
        if let Some(stop_reason) = stop_reason {
            return self.finish(Some(stop_reason));
        }
        Vec::new()
    }

    fn capture_usage(&mut self, usage: Option<&serde_json::Value>) {
        let Some(usage) = usage else { return };
        if let Some(input) = usage.get("input_tokens").and_then(|v| v.as_i64()) {
            self.usage.input_tokens = Some(input);
        }
        if let Some(output) = usage.get("output_tokens").and_then(|v| v.as_i64()) {
            self.usage.output_tokens = Some(output);
        }
    }

    /// Ends the response, flushing any call whose block never closed. Idempotent,
    /// since both `message_delta` and `message_stop` can trigger it.
    pub fn finish(&mut self, stop_reason: Option<String>) -> Vec<StreamEvent> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;
        let mut events = self.calls.take_all();
        events.push(StreamEvent::Done { stop_reason });
        events
    }
}

fn block_index(data: &serde_json::Value) -> usize {
    data.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize
}

pub fn describe_failure(status: u16, body: &str) -> String {
    // The error envelope matches the OpenAI shape closely enough that the same
    // extraction and wording apply.
    super::openai::describe_failure(status, body)
}

/// Issues the streaming request. `on_event` sees each event as it is produced.
pub async fn stream_response(
    base_url: &str,
    api_key: &str,
    headers: &std::collections::BTreeMap<String, String>,
    body: &serde_json::Value,
    cancel: &tokio_util::sync::CancellationToken,
    mut on_event: impl FnMut(StreamEvent),
) -> AppResult<Usage> {
    use futures_util::StreamExt;

    let url = format!("{}/messages", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| AppError::internal(error.to_string()))?;

    let mut request = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01");
    for (name, value) in headers {
        request = request.header(name, value);
    }

    let response = request.json(body).send().await.map_err(|error| {
        AppError::internal(super::openai::describe_transport_failure(&url, &error))
    })?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        // Tagged so a caller holding several keys can retire this one and retry.
        return Err(super::protocol::http_failure(
            status.as_u16(),
            describe_failure(status.as_u16(), &text),
        ));
    }

    let mut parser = super::sse::SseParser::new();
    let mut folder = StreamFolder::new();
    let mut bytes = response.bytes_stream();

    loop {
        let chunk = tokio::select! {
            _ = cancel.cancelled() => return Ok(folder.usage()),
            chunk = bytes.next() => chunk,
        };
        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|error| AppError::internal(error.to_string()))?;

        for event in parser.push(&String::from_utf8_lossy(&chunk)) {
            for produced in folder.push_event(event.name.as_deref(), &event.data) {
                on_event(produced);
            }
        }
        if folder.is_finished() {
            return Ok(folder.usage());
        }
    }

    if let Some(event) = parser.finish() {
        for produced in folder.push_event(event.name.as_deref(), &event.data) {
            on_event(produced);
        }
    }
    for produced in folder.finish(None) {
        on_event(produced);
    }
    Ok(folder.usage())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ChatToolCall;

    fn tool() -> ToolDefinition {
        ToolDefinition {
            name: "find_job".to_string(),
            description: Some("Locate a job".to_string()),
            input_schema: json!({"type": "object"}),
        }
    }

    #[test]
    fn the_system_prompt_is_a_top_level_field() {
        let body = build_request(
            "claude-opus-4-8",
            Some("be terse"),
            &[],
            &[Turn::User {
                text: "hi".to_string(),
            }],
            None,
        );
        assert_eq!(body["system"], "be terse");
        // It is not smuggled in as a message.
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        // max_tokens is required by the API, so it always has a value.
        assert_eq!(body["max_tokens"], DEFAULT_MAX_TOKENS);
    }

    #[test]
    fn max_tokens_can_be_overridden() {
        let body = build_request("claude-opus-4-8", None, &[], &[], Some(1024));
        assert_eq!(body["max_tokens"], 1024);
        assert!(body.get("system").is_none());
    }

    #[test]
    fn tools_carry_their_input_schema() {
        let body = build_request("claude-opus-4-8", None, &[tool()], &[], None);
        assert_eq!(body["tools"][0]["name"], "find_job");
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
    }

    #[test]
    fn tool_use_and_results_are_content_blocks() {
        let call = ChatToolCall {
            call_id: "toolu_1".to_string(),
            tool: "find_job".to_string(),
            args: json!({"jobId": "abc"}),
            result: None,
            error: None,
            duration_ms: None,
        };
        let body = build_request(
            "claude-opus-4-8",
            None,
            &[tool()],
            &[
                Turn::Assistant {
                    text: Some("looking".to_string()),
                    tool_calls: vec![call],
                },
                Turn::ToolResult {
                    call_id: "toolu_1".to_string(),
                    tool: "find_job".to_string(),
                    content: "{\"found\":true}".to_string(),
                    is_error: false,
                },
            ],
            None,
        );

        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[0]["content"][0]["type"], "text");
        assert_eq!(messages[0]["content"][1]["type"], "tool_use");
        // Input is a JSON object here, not a string.
        assert_eq!(messages[0]["content"][1]["input"]["jobId"], "abc");

        // A tool result is a user-role block referencing the call.
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"][0]["type"], "tool_result");
        assert_eq!(messages[1]["content"][0]["tool_use_id"], "toolu_1");
        assert_eq!(messages[1]["content"][0]["is_error"], false);
    }

    #[test]
    fn a_failed_tool_result_is_flagged() {
        let body = build_request(
            "claude-opus-4-8",
            None,
            &[],
            &[Turn::ToolResult {
                call_id: "toolu_1".to_string(),
                tool: "find_job".to_string(),
                content: "job not found".to_string(),
                is_error: true,
            }],
            None,
        );
        assert_eq!(body["messages"][0]["content"][0]["is_error"], true);
    }

    #[test]
    fn an_empty_assistant_turn_is_skipped() {
        // Not representable in this shape, and sending it breaks the alternation.
        let body = build_request(
            "claude-opus-4-8",
            None,
            &[],
            &[Turn::Assistant {
                text: None,
                tool_calls: vec![],
            }],
            None,
        );
        assert!(body["messages"].as_array().unwrap().is_empty());
    }

    #[test]
    fn text_deltas_are_folded() {
        let mut folder = StreamFolder::new();
        let events = folder.push_event(
            Some("content_block_delta"),
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#,
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("Hello".to_string())]);
    }

    #[test]
    fn a_tool_call_is_emitted_when_its_block_closes() {
        let mut folder = StreamFolder::new();

        folder.push_event(
            None,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"find_job"}}"#,
        );
        folder.push_event(
            None,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"jobId\":"}}"#,
        );
        folder.push_event(
            None,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"abc\"}"}}"#,
        );

        // The block closing is what completes the call — no need to wait for the
        // message to end.
        let events = folder.push_event(None, r#"{"type":"content_block_stop","index":1}"#);
        assert_eq!(
            events,
            vec![StreamEvent::ToolCall {
                call_id: "toolu_1".to_string(),
                tool: "find_job".to_string(),
                arguments: "{\"jobId\":\"abc\"}".to_string()
            }]
        );
    }

    #[test]
    fn a_text_block_closing_emits_nothing() {
        let mut folder = StreamFolder::new();
        folder.push_event(
            None,
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
        );
        assert!(folder
            .push_event(None, r#"{"type":"content_block_stop","index":0}"#)
            .is_empty());
    }

    #[test]
    fn the_stop_reason_ends_the_response_once() {
        let mut folder = StreamFolder::new();
        let events = folder.push_event(
            None,
            r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}"#,
        );
        assert_eq!(
            events,
            vec![StreamEvent::Done {
                stop_reason: Some("tool_use".to_string())
            }]
        );
        assert_eq!(folder.usage().output_tokens, Some(42));
        // message_stop arriving afterwards must not produce a second Done.
        assert!(folder
            .push_event(None, r#"{"type":"message_stop"}"#)
            .is_empty());
    }

    #[test]
    fn usage_accumulates_across_message_start_and_delta() {
        let mut folder = StreamFolder::new();
        folder.push_event(
            None,
            r#"{"type":"message_start","message":{"usage":{"input_tokens":100}}}"#,
        );
        folder.push_event(
            None,
            r#"{"type":"message_delta","delta":{},"usage":{"output_tokens":7}}"#,
        );
        assert_eq!(folder.usage().input_tokens, Some(100));
        assert_eq!(folder.usage().output_tokens, Some(7));
    }

    #[test]
    fn an_in_stream_error_terminates_with_its_message() {
        let mut folder = StreamFolder::new();
        let events = folder.push_event(
            None,
            r#"{"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}"#,
        );
        assert_eq!(
            events,
            vec![StreamEvent::Done {
                stop_reason: Some("error: overloaded".to_string())
            }]
        );
    }

    #[test]
    fn unknown_and_unparseable_events_are_ignored() {
        let mut folder = StreamFolder::new();
        assert!(folder.push_event(Some("ping"), r#"{"type":"ping"}"#).is_empty());
        assert!(folder.push_event(None, "not json").is_empty());
        assert!(!folder.is_finished());
    }
}
