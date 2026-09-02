//! OpenAI-shaped chat completions over SSE.
//!
//! This is also the path for every OpenAI-compatible gateway, so it is written
//! to what the *shape* promises — `/chat/completions`, Bearer auth,
//! `choices[].delta` — rather than to one vendor's behaviour.
//!
//! The request builder and the delta folder are pure functions so they can be
//! tested without a network; only `stream_response` touches HTTP.

use super::protocol::{StreamEvent, ToolCallAccumulator, ToolDefinition, Turn, Usage};
use crate::error::{AppError, AppResult};
use serde_json::json;

/// Builds the request body from conversation history and the available tools.
pub fn build_request(
    model: &str,
    system_prompt: Option<&str>,
    tools: &[ToolDefinition],
    history: &[Turn],
) -> serde_json::Value {
    let mut messages: Vec<serde_json::Value> = Vec::new();
    if let Some(system_prompt) = system_prompt.filter(|text| !text.trim().is_empty()) {
        messages.push(json!({ "role": "system", "content": system_prompt }));
    }
    for turn in history {
        append_turn(&mut messages, turn);
    }

    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });
    if !tools.is_empty() {
        body["tools"] = serde_json::Value::Array(
            tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema,
                        }
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
            let mut message = json!({
                "role": "assistant",
                // The field must be present even when the turn was only tool
                // calls; gateways differ on whether they accept it missing.
                "content": text.clone().map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
            });
            if !tool_calls.is_empty() {
                message["tool_calls"] = serde_json::Value::Array(
                    tool_calls
                        .iter()
                        .map(|call| {
                            json!({
                                "id": call.call_id,
                                "type": "function",
                                "function": {
                                    "name": call.tool,
                                    // Arguments go back as a JSON *string*, the
                                    // same way they arrived.
                                    "arguments": serde_json::to_string(&call.args).unwrap_or_else(|_| "{}".to_string()),
                                }
                            })
                        })
                        .collect(),
                );
            }
            messages.push(message);
        }
        Turn::ToolResult {
            call_id, content, ..
        } => {
            // This shape has no error flag on tool messages: a failure is
            // content, and the model is expected to react to it.
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": content,
            }));
        }
    }
}

/// Folds SSE payloads into provider-neutral stream events.
///
/// Separate from the HTTP call because this is where the format-specific
/// subtleties live: text and tool-call fragments interleave, arguments arrive in
/// pieces addressed by index, and the response ends on a `finish_reason` inside a
/// choice rather than a distinct event.
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

    /// Handles one `data:` payload, returning the events it produced.
    pub fn push_payload(&mut self, payload: &str) -> Vec<StreamEvent> {
        if payload.trim() == "[DONE]" {
            return self.finish(Some("stop".to_string()));
        }
        // Keep-alives and blank frames are not JSON; ignoring them is correct.
        let Ok(data) = serde_json::from_str::<serde_json::Value>(payload) else {
            return Vec::new();
        };

        let mut events = Vec::new();

        if let Some(usage) = data.get("usage").filter(|usage| !usage.is_null()) {
            self.usage.input_tokens = usage.get("prompt_tokens").and_then(|v| v.as_i64());
            self.usage.output_tokens = usage.get("completion_tokens").and_then(|v| v.as_i64());
        }

        let Some(choice) = data
            .get("choices")
            .and_then(|choices| choices.as_array())
            .and_then(|choices| choices.first())
        else {
            return events;
        };

        if let Some(delta) = choice.get("delta") {
            if let Some(text) = delta
                .get("content")
                .and_then(|content| content.as_str())
                .filter(|text| !text.is_empty())
            {
                events.push(StreamEvent::TextDelta(text.to_string()));
            }
            if let Some(calls) = delta.get("tool_calls").and_then(|calls| calls.as_array()) {
                for call in calls {
                    let index = call.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                    let function = call.get("function");
                    self.calls.push(
                        index,
                        call.get("id").and_then(|id| id.as_str()),
                        function
                            .and_then(|f| f.get("name"))
                            .and_then(|n| n.as_str()),
                        function
                            .and_then(|f| f.get("arguments"))
                            .and_then(|a| a.as_str()),
                    );
                }
            }
        }

        // The response ends on a choice carrying finish_reason, at which point
        // every accumulated tool call is complete.
        if let Some(reason) = choice
            .get("finish_reason")
            .and_then(|reason| reason.as_str())
            .filter(|reason| !reason.is_empty())
        {
            events.extend(self.finish(Some(reason.to_string())));
        }

        events
    }

    /// Ends the response, flushing collected tool calls. Idempotent: a stream
    /// that sends both `finish_reason` and `[DONE]` must not yield two `Done`s.
    pub fn finish(&mut self, stop_reason: Option<String>) -> Vec<StreamEvent> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;
        let mut events = self.calls.take_all();
        events.push(StreamEvent::Done { stop_reason });
        events
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }
}

/// Turns a failure to reach the endpoint at all into one readable line.
///
/// `reqwest`'s own `Display` already echoes the URL ("error sending request for
/// url (https://...)"), so naming the URL again produces the same address twice
/// in one sentence. This keeps the URL once and appends only the underlying
/// cause, which is the part that says *why* — DNS, TLS, refused connection.
pub fn describe_transport_failure(url: &str, error: &reqwest::Error) -> String {
    // Walk to the innermost source: the outer layers restate the request, the
    // root says what actually went wrong.
    let mut cause: &dyn std::error::Error = error;
    while let Some(source) = cause.source() {
        cause = source;
    }
    let detail = cause.to_string();

    // A root cause that just repeats the wrapper adds nothing.
    if detail.is_empty() || detail.contains(url) {
        format!("Could not reach {url}.")
    } else {
        format!("Could not reach {url}: {detail}")
    }
}

/// Turns a non-2xx response into something the user can act on. A 401 is almost
/// always a wrong key; a 404 almost always a base URL with or without `/v1`.
pub fn describe_failure(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .or_else(|| value.get("message"))
                .and_then(|message| message.as_str())
                .map(|message| message.chars().take(300).collect::<String>())
        })
        .map(|message| format!(" {message}"))
        .unwrap_or_default();
    match status {
        401 | 403 => format!("Authentication failed ({status}). Check the API key.{detail}"),
        404 => format!(
            "No chat endpoint at this address ({status}). Check whether the base URL should include /v1.{detail}"
        ),
        429 => format!("Rate limited by the provider ({status}).{detail}"),
        _ => format!("The provider returned HTTP {status}.{detail}"),
    }
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

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = super::protocol::streaming_client()?;

    let mut request = client.post(&url).bearer_auth(api_key);
    // Custom headers are applied after the protocol's own; names that would
    // shadow one are rejected when they are configured, not silently here.
    for (name, value) in headers {
        request = request.header(name, value);
    }

    // The request is raced against the token: establishing the stream can hang for
    // as long as the provider holds the socket, and a stop pressed during that
    // wait has to be observed here rather than after the first byte.
    let response = super::protocol::until_cancelled(cancel, request.json(body).send())
        .await
        .ok_or_else(super::protocol::cancelled)?
        .map_err(|error| AppError::internal(describe_transport_failure(&url, &error)))?;

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
            // Stopping mid-stream is a user action, not an error.
            _ = cancel.cancelled() => return Ok(folder.usage()),
            chunk = bytes.next() => chunk,
        };
        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|error| AppError::internal(error.to_string()))?;

        for event in parser.push(&String::from_utf8_lossy(&chunk)) {
            for produced in folder.push_payload(&event.data) {
                on_event(produced);
            }
        }
        if folder.is_finished() {
            return Ok(folder.usage());
        }
    }

    // A stream that ended without a terminator still has to release its calls.
    if let Some(event) = parser.finish() {
        for produced in folder.push_payload(&event.data) {
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
            input_schema: json!({"type": "object", "properties": {"jobId": {"type": "string"}}}),
        }
    }

    #[test]
    fn the_system_prompt_leads_the_message_list() {
        let body = build_request(
            "gpt-4o",
            Some("be terse"),
            &[],
            &[Turn::User {
                text: "hi".to_string(),
            }],
        );
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "be terse");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(body["stream"], true);
        // No tools advertised means the key is absent, not an empty array.
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn a_blank_system_prompt_is_omitted() {
        let body = build_request("gpt-4o", Some("   "), &[], &[]);
        assert!(body["messages"].as_array().unwrap().is_empty());
    }

    #[test]
    fn tools_are_advertised_as_functions() {
        let body = build_request("gpt-4o", None, &[tool()], &[]);
        let tools = body["tools"].as_array().unwrap();
        assert_eq!(tools[0]["type"], "function");
        assert_eq!(tools[0]["function"]["name"], "find_job");
        assert_eq!(tools[0]["function"]["parameters"]["type"], "object");
    }

    #[test]
    fn a_tool_round_trip_keeps_the_call_id_linkage() {
        let call = ChatToolCall {
            call_id: "call_1".to_string(),
            tool: "find_job".to_string(),
            args: json!({"jobId": "abc"}),
            result: None,
            error: None,
            duration_ms: None,
        };
        let body = build_request(
            "gpt-4o",
            None,
            &[tool()],
            &[
                Turn::User {
                    text: "why did it fail?".to_string(),
                },
                Turn::Assistant {
                    text: None,
                    tool_calls: vec![call],
                },
                Turn::ToolResult {
                    call_id: "call_1".to_string(),
                    tool: "find_job".to_string(),
                    content: "{\"found\":true}".to_string(),
                    is_error: false,
                },
            ],
        );

        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[1]["role"], "assistant");
        assert!(messages[1]["content"].is_null());
        assert_eq!(messages[1]["tool_calls"][0]["id"], "call_1");
        // Arguments go back as a string, the way the wire format expects.
        assert_eq!(
            messages[1]["tool_calls"][0]["function"]["arguments"],
            "{\"jobId\":\"abc\"}"
        );
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "call_1");
        assert_eq!(messages[2]["content"], "{\"found\":true}");
    }

    #[test]
    fn a_failed_tool_result_is_sent_as_content() {
        let body = build_request(
            "gpt-4o",
            None,
            &[],
            &[Turn::ToolResult {
                call_id: "c1".to_string(),
                tool: "find_job".to_string(),
                content: "job not found".to_string(),
                is_error: true,
            }],
        );
        // The model has to see the failure to react to it.
        assert_eq!(body["messages"][0]["content"], "job not found");
    }

    #[test]
    fn text_deltas_are_folded_in_order() {
        let mut folder = StreamFolder::new();
        let mut events = Vec::new();
        events.extend(folder.push_payload(r#"{"choices":[{"delta":{"content":"Hel"}}]}"#));
        events.extend(folder.push_payload(r#"{"choices":[{"delta":{"content":"lo"}}]}"#));

        assert_eq!(
            events,
            vec![
                StreamEvent::TextDelta("Hel".to_string()),
                StreamEvent::TextDelta("lo".to_string())
            ]
        );
    }

    #[test]
    fn a_tool_call_is_emitted_once_its_arguments_complete() {
        let mut folder = StreamFolder::new();

        // Fragments produce nothing on their own.
        assert!(folder
            .push_payload(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"find_job","arguments":"{\"jobId\":"}}]}}]}"#
            )
            .is_empty());
        assert!(folder
            .push_payload(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"abc\"}"}}]}}]}"#
            )
            .is_empty());

        let events = folder.push_payload(r#"{"choices":[{"finish_reason":"tool_calls"}]}"#);
        assert_eq!(
            events,
            vec![
                StreamEvent::ToolCall {
                    call_id: "c1".to_string(),
                    tool: "find_job".to_string(),
                    arguments: "{\"jobId\":\"abc\"}".to_string()
                },
                StreamEvent::Done {
                    stop_reason: Some("tool_calls".to_string())
                }
            ]
        );
    }

    #[test]
    fn finishing_is_idempotent_across_finish_reason_and_done() {
        let mut folder = StreamFolder::new();
        let first = folder.push_payload(r#"{"choices":[{"finish_reason":"stop"}]}"#);
        assert_eq!(first.len(), 1);
        // A stream that sends both must not produce a second Done.
        assert!(folder.push_payload("[DONE]").is_empty());
        assert!(folder.finish(None).is_empty());
    }

    #[test]
    fn the_done_sentinel_alone_terminates_the_response() {
        let mut folder = StreamFolder::new();
        assert_eq!(
            folder.push_payload("[DONE]"),
            vec![StreamEvent::Done {
                stop_reason: Some("stop".to_string())
            }]
        );
        assert!(folder.is_finished());
    }

    #[test]
    fn usage_is_captured_when_reported() {
        let mut folder = StreamFolder::new();
        folder.push_payload(r#"{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34}}"#);
        assert_eq!(folder.usage().input_tokens, Some(12));
        assert_eq!(folder.usage().output_tokens, Some(34));
    }

    #[test]
    fn unparseable_frames_are_ignored() {
        let mut folder = StreamFolder::new();
        assert!(folder.push_payload("").is_empty());
        assert!(folder.push_payload("not json").is_empty());
        assert!(folder.push_payload("{}").is_empty());
        assert!(!folder.is_finished());
    }

    #[test]
    fn http_failures_name_the_likely_cause() {
        let unauthorized = describe_failure(401, r#"{"error":{"message":"bad key"}}"#);
        assert!(unauthorized.contains("API key"), "{unauthorized}");
        assert!(unauthorized.contains("bad key"), "{unauthorized}");
        assert!(describe_failure(404, "").contains("/v1"));
        assert!(describe_failure(500, "boom").contains("500"));
    }

    #[tokio::test]
    async fn an_unreachable_endpoint_names_the_url_once() {
        // A domain that cannot resolve is the common shape of this failure: a
        // typo'd base URL, or no network.
        let url = "https://unreachable.invalid/v1/chat/completions";
        let error = reqwest::Client::new()
            .post(url)
            .send()
            .await
            .expect_err("an unresolvable host must fail");

        let message = describe_transport_failure(url, &error);

        // reqwest's own Display already carries the URL, so naming it again used
        // to print the same address twice in one sentence.
        assert_eq!(message.matches(url).count(), 1, "{message}");
        assert!(message.starts_with("Could not reach"), "{message}");
        // And the wrapper's "error sending request" restatement is dropped in
        // favour of the root cause.
        assert!(!message.contains("error sending request"), "{message}");
    }
}
