//! Gemini-shaped `generateContent` over SSE.
//!
//! A third module rather than a branch in `openai.rs`, because the differences
//! are larger than the ones between the other two shapes: roles are
//! `user`/`model`, history is `contents[].parts[]`, tool calls carry no id at
//! all, the system prompt is a `systemInstruction` object, and each SSE frame is
//! a complete response rather than a delta envelope.
//!
//! The request builder and the frame folder are pure functions so they can be
//! tested without a network; only `stream_response` touches HTTP.

use super::protocol::{StreamEvent, ToolDefinition, Turn, Usage};
use crate::error::{AppError, AppResult};
use serde_json::json;
use std::collections::BTreeMap;

pub fn build_request(
    system_prompt: Option<&str>,
    tools: &[ToolDefinition],
    history: &[Turn],
) -> serde_json::Value {
    let mut contents: Vec<serde_json::Value> = Vec::new();
    for turn in history {
        append_turn(&mut contents, turn);
    }

    let mut body = json!({ "contents": contents });
    // Not a message in the list — a sibling of it.
    if let Some(system_prompt) = system_prompt.filter(|text| !text.trim().is_empty()) {
        body["systemInstruction"] = json!({ "parts": [{ "text": system_prompt }] });
    }
    if !tools.is_empty() {
        body["tools"] = json!([{
            "functionDeclarations": tools
                .iter()
                .map(|tool| json!({
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": to_gemini_schema(&tool.input_schema),
                }))
                .collect::<Vec<_>>(),
        }]);
    }
    body
}

/// Converts a JSON Schema into the subset Gemini's `Schema` proto accepts.
///
/// This is a translation, not a filter. The API rejects unknown fields with a 400
/// instead of ignoring them, and its `Schema` is a protobuf message, so several
/// things JSON Schema allows are not merely redundant here but ill-typed:
///
/// - `"type": ["integer", "null"]` — what `schemars` emits for `Option<T>` — is a
///   list where the proto has a single enum, which fails as *"Proto field is not
///   repeating, cannot start list"*. The null member becomes `nullable: true` and
///   the real type is kept.
/// - `$schema`, `default`, `minimum`, `additionalProperties`, `$defs` and friends
///   have no counterpart at all.
/// - `format` is an open string in JSON Schema but an enum per type here, so only
///   the values the proto names survive (`uint`, which `schemars` emits for
///   `usize`, is not one of them).
///
/// Hence a whitelist: anything not known to round-trip is dropped, because a
/// dropped constraint costs a little validation while an unknown field costs the
/// whole request.
fn to_gemini_schema(schema: &serde_json::Value) -> serde_json::Value {
    /// Fields the proto accepts and that carry over unchanged in meaning.
    const PASSTHROUGH: [&str; 6] = [
        "description",
        "enum",
        "maxItems",
        "minItems",
        "nullable",
        "title",
    ];
    /// `format` values the proto names, by the type they belong to.
    const FORMATS: [&str; 5] = ["date-time", "double", "float", "int32", "int64"];

    let serde_json::Value::Object(fields) = schema else {
        // A boolean schema (`true`/`false`) has no proto equivalent; the loosest
        // honest translation is "some object".
        return json!({ "type": "object" });
    };

    let mut out = serde_json::Map::new();

    if let Some((type_name, nullable)) = normalise_type(fields.get("type")) {
        out.insert("type".to_string(), json!(type_name));
        if nullable {
            out.insert("nullable".to_string(), json!(true));
        }
    }

    for key in PASSTHROUGH {
        if let Some(value) = fields.get(key) {
            // An explicit `nullable` must not undo one derived from the type list.
            if key == "nullable" && out.contains_key("nullable") {
                continue;
            }
            out.insert(key.to_string(), value.clone());
        }
    }

    if let Some(format) = fields.get("format").and_then(|value| value.as_str()) {
        if FORMATS.contains(&format) {
            out.insert("format".to_string(), json!(format));
        }
    }

    if let Some(serde_json::Value::Object(properties)) = fields.get("properties") {
        let converted: serde_json::Map<String, serde_json::Value> = properties
            .iter()
            .map(|(name, value)| (name.clone(), to_gemini_schema(value)))
            .collect();
        out.insert("properties".to_string(), serde_json::Value::Object(converted));
        // An object schema with properties but no declared type still has to say
        // it is an object.
        out.entry("type").or_insert_with(|| json!("object"));
    }

    if let Some(items) = fields.get("items") {
        out.insert("items".to_string(), to_gemini_schema(items));
        out.entry("type").or_insert_with(|| json!("array"));
    }

    // Only names that survived as properties may be required, or the API rejects
    // the reference.
    if let Some(required) = fields.get("required").and_then(|value| value.as_array()) {
        let known: Vec<serde_json::Value> = required
            .iter()
            .filter(|name| {
                name.as_str().is_some_and(|name| {
                    out.get("properties")
                        .and_then(|properties| properties.get(name))
                        .is_some()
                })
            })
            .cloned()
            .collect();
        if !known.is_empty() {
            out.insert("required".to_string(), serde_json::Value::Array(known));
        }
    }

    // A schema that named nothing usable still has to be a valid `Schema`.
    if out.is_empty() {
        return json!({ "type": "object" });
    }
    serde_json::Value::Object(out)
}

/// Resolves a JSON Schema `type` into the proto's single type plus nullability.
///
/// `["integer", "null"]` is how `schemars` writes `Option<T>`, and it is the shape
/// that provoked the 400 this function exists to prevent.
fn normalise_type(value: Option<&serde_json::Value>) -> Option<(String, bool)> {
    match value? {
        serde_json::Value::String(name) => {
            // A bare "null" type carries no information the proto can express.
            (name != "null").then(|| (name.clone(), false))
        }
        serde_json::Value::Array(names) => {
            let mut nullable = false;
            let mut resolved: Option<String> = None;
            for name in names.iter().filter_map(|name| name.as_str()) {
                if name == "null" {
                    nullable = true;
                } else if resolved.is_none() {
                    // Genuine unions ("string" or "number") are not expressible;
                    // the first member is the closest single type.
                    resolved = Some(name.to_string());
                }
            }
            resolved.map(|name| (name, nullable))
        }
        _ => None,
    }
}

fn append_turn(contents: &mut Vec<serde_json::Value>, turn: &Turn) {
    match turn {
        Turn::User { text } => {
            contents.push(json!({ "role": "user", "parts": [{ "text": text }] }));
        }
        Turn::Assistant { text, tool_calls } => {
            let mut parts: Vec<serde_json::Value> = Vec::new();
            if let Some(text) = text.as_deref().filter(|text| !text.is_empty()) {
                parts.push(json!({ "text": text }));
            }
            for call in tool_calls {
                // No id field exists here: a call is identified by its name.
                parts.push(json!({
                    "functionCall": { "name": call.tool, "args": call.args },
                }));
            }
            // The assistant role is called "model".
            if !parts.is_empty() {
                contents.push(json!({ "role": "model", "parts": parts }));
            }
        }
        Turn::ToolResult {
            tool,
            content,
            is_error,
            ..
        } => {
            // A result is a user-role part naming the function it answers. The
            // response must be an object, so free text is wrapped — and a failure
            // is labelled rather than hidden, so the model can retry differently.
            let response = if *is_error {
                json!({ "error": content })
            } else {
                json!({ "result": content })
            };
            contents.push(json!({
                "role": "user",
                "parts": [{ "functionResponse": { "name": tool, "response": response } }],
            }));
        }
    }
}

/// Folds SSE frames into provider-neutral stream events.
///
/// Unlike the other two shapes there is nothing to accumulate: every frame is a
/// whole `GenerateContentResponse`, so a `functionCall` part arrives with its
/// arguments already complete.
#[derive(Debug, Default)]
pub struct StreamFolder {
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

    /// Handles one frame's payload.
    pub fn push_payload(&mut self, payload: &str) -> Vec<StreamEvent> {
        let Ok(data) = serde_json::from_str::<serde_json::Value>(payload) else {
            return Vec::new();
        };

        // An in-stream error arrives as a body rather than an HTTP status, so it
        // must not be silently swallowed.
        if let Some(message) = data
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|message| message.as_str())
        {
            return self.finish(Some(format!("error: {message}")));
        }

        self.capture_usage(data.get("usageMetadata"));

        let mut events = Vec::new();
        let candidate = data
            .get("candidates")
            .and_then(|candidates| candidates.as_array())
            .and_then(|candidates| candidates.first());

        if let Some(parts) = candidate
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(|parts| parts.as_array())
        {
            for part in parts {
                if let Some(text) = part
                    .get("text")
                    .and_then(|text| text.as_str())
                    .filter(|text| !text.is_empty())
                {
                    events.push(StreamEvent::TextDelta(text.to_string()));
                }
                if let Some(call) = part.get("functionCall") {
                    if let Some(name) = call.get("name").and_then(|name| name.as_str()) {
                        events.push(StreamEvent::ToolCall {
                            // The wire format has no id, but the rest of the app
                            // correlates results by one, so it is minted here.
                            call_id: uuid::Uuid::new_v4().to_string(),
                            tool: name.to_string(),
                            arguments: call
                                .get("args")
                                .map(|args| args.to_string())
                                .unwrap_or_else(|| "{}".to_string()),
                        });
                    }
                }
            }
        }

        if let Some(reason) = candidate
            .and_then(|candidate| candidate.get("finishReason"))
            .and_then(|reason| reason.as_str())
            .filter(|reason| !reason.is_empty())
        {
            events.extend(self.finish(Some(reason.to_string())));
        }

        events
    }

    fn capture_usage(&mut self, usage: Option<&serde_json::Value>) {
        let Some(usage) = usage else { return };
        if let Some(input) = usage.get("promptTokenCount").and_then(|v| v.as_i64()) {
            self.usage.input_tokens = Some(input);
        }
        if let Some(output) = usage.get("candidatesTokenCount").and_then(|v| v.as_i64()) {
            self.usage.output_tokens = Some(output);
        }
    }

    /// Ends the response. Idempotent: a stream carrying `finishReason` on more
    /// than one frame must not yield two `Done`s.
    pub fn finish(&mut self, stop_reason: Option<String>) -> Vec<StreamEvent> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;
        vec![StreamEvent::Done { stop_reason }]
    }
}

/// Turns a non-2xx response into something the user can act on.
///
/// The error envelope is `{"error": {"message": ...}}`, same as the other two,
/// so the shared wording applies — but the 404 hint differs: this API's paths
/// are versioned as `/v1beta` rather than `/v1`.
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
        400 => format!("The provider rejected the request ({status}).{detail}"),
        401 | 403 => format!("Authentication failed ({status}). Check the API key.{detail}"),
        404 => format!(
            "No such model or path at this address ({status}). Check the model id and whether the base URL should end in /v1beta.{detail}"
        ),
        429 => format!("Rate limited by the provider ({status}).{detail}"),
        _ => format!("The provider returned HTTP {status}.{detail}"),
    }
}

/// The streaming URL. The model id is part of the path here, not the body, and
/// `alt=sse` is what turns the response into an event stream rather than a JSON
/// array.
pub fn stream_url(base_url: &str, model: &str) -> String {
    format!(
        "{}/models/{}:streamGenerateContent?alt=sse",
        base_url.trim_end_matches('/'),
        model
    )
}

/// Issues the streaming request. `on_event` sees each event as it is produced.
pub async fn stream_response(
    base_url: &str,
    model: &str,
    api_key: &str,
    headers: &BTreeMap<String, String>,
    body: &serde_json::Value,
    cancel: &tokio_util::sync::CancellationToken,
    mut on_event: impl FnMut(StreamEvent),
) -> AppResult<Usage> {
    use futures_util::StreamExt;

    let url = stream_url(base_url, model);
    let client = super::protocol::streaming_client()?;

    let mut request = client.post(&url).header("x-goog-api-key", api_key);
    for (name, value) in headers {
        request = request.header(name, value);
    }

    // The request is raced against the token: establishing the stream can hang for
    // as long as the provider holds the socket, and a stop pressed during that
    // wait has to be observed here rather than after the first byte.
    let response = super::protocol::until_cancelled(cancel, request.json(body).send())
        .await
        .ok_or_else(super::protocol::cancelled)?
        .map_err(|error| {
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
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "additionalProperties": false,
                "properties": {"jobId": {"type": "string"}}
            }),
        }
    }

    #[test]
    fn the_system_prompt_is_a_sibling_of_the_contents() {
        let body = build_request(
            Some("be terse"),
            &[],
            &[Turn::User {
                text: "hi".to_string(),
            }],
        );
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "be terse");
        // It is not smuggled into the message list.
        let contents = body["contents"].as_array().unwrap();
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[0]["parts"][0]["text"], "hi");
    }

    #[test]
    fn a_blank_system_prompt_is_omitted() {
        let body = build_request(Some("   "), &[], &[]);
        assert!(body.get("systemInstruction").is_none());
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn tools_are_declared_with_schemas_this_api_accepts() {
        let body = build_request(None, &[tool()], &[]);
        let declaration = &body["tools"][0]["functionDeclarations"][0];
        assert_eq!(declaration["name"], "find_job");
        // The parameters key is not called "input_schema" here.
        assert_eq!(declaration["parameters"]["type"], "object");
        assert_eq!(
            declaration["parameters"]["properties"]["jobId"]["type"],
            "string"
        );
        // Keywords this API answers with a 400 are stripped rather than sent.
        assert!(declaration["parameters"].get("$schema").is_none());
        assert!(declaration["parameters"].get("additionalProperties").is_none());
    }

    #[test]
    fn an_optional_field_becomes_a_single_type_plus_nullable() {
        // `schemars` writes Option<usize> as a type *list*, which this API's proto
        // rejects outright: "Proto field is not repeating, cannot start list".
        let converted = to_gemini_schema(&json!({
            "type": "object",
            "properties": {
                "tailLines": {
                    "description": "How many trailing lines to return.",
                    "type": ["integer", "null"],
                    "format": "uint",
                    "default": null,
                    "minimum": 0
                }
            }
        }));

        let field = &converted["properties"]["tailLines"];
        assert_eq!(field["type"], "integer");
        assert_eq!(field["nullable"], true);
        assert_eq!(field["description"], "How many trailing lines to return.");
        // `uint` is not one of the formats the proto names, so it is dropped
        // rather than sent and rejected.
        assert!(field.get("format").is_none());
        // Neither has a proto counterpart.
        assert!(field.get("default").is_none());
        assert!(field.get("minimum").is_none());
    }

    #[test]
    fn known_formats_survive_and_unknown_ones_do_not() {
        let kept = to_gemini_schema(&json!({"type": "string", "format": "date-time"}));
        assert_eq!(kept["format"], "date-time");

        let dropped = to_gemini_schema(&json!({"type": "integer", "format": "uint64"}));
        assert!(dropped.get("format").is_none());
        assert_eq!(dropped["type"], "integer");
    }

    #[test]
    fn unrepresentable_keywords_are_dropped_throughout() {
        let converted = to_gemini_schema(&json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "GetJobLogTextArgs",
            "type": "object",
            "additionalProperties": false,
            "$defs": {"Other": {"type": "string"}},
            "properties": {
                "nested": {
                    "type": "object",
                    "additionalProperties": false,
                    "$schema": "x",
                    "properties": {"inner": {"type": "string", "pattern": "^a"}}
                }
            }
        }));

        assert!(converted.get("$schema").is_none());
        assert!(converted.get("additionalProperties").is_none());
        assert!(converted.get("$defs").is_none());
        // The title is one of the few fields that does carry over.
        assert_eq!(converted["title"], "GetJobLogTextArgs");

        // Recursion reaches nested property schemas.
        let nested = &converted["properties"]["nested"];
        assert!(nested.get("additionalProperties").is_none());
        assert!(nested.get("$schema").is_none());
        assert_eq!(nested["type"], "object");
        assert_eq!(nested["properties"]["inner"]["type"], "string");
        assert!(nested["properties"]["inner"].get("pattern").is_none());
    }

    #[test]
    fn required_names_that_did_not_survive_are_not_referenced() {
        let converted = to_gemini_schema(&json!({
            "type": "object",
            "properties": {"jobId": {"type": "string"}},
            "required": ["jobId", "vanished"]
        }));
        // Naming a property that is not in `properties` is itself a 400.
        assert_eq!(converted["required"], json!(["jobId"]));
    }

    #[test]
    fn array_and_object_types_are_inferred_when_omitted() {
        let array = to_gemini_schema(&json!({"items": {"type": "string"}}));
        assert_eq!(array["type"], "array");
        assert_eq!(array["items"]["type"], "string");

        let object = to_gemini_schema(&json!({"properties": {"a": {"type": "string"}}}));
        assert_eq!(object["type"], "object");
    }

    #[test]
    fn a_schema_with_nothing_usable_is_still_a_valid_object() {
        // Every declaration needs a `Schema`, so an empty or boolean one becomes
        // the loosest honest translation rather than nothing.
        assert_eq!(to_gemini_schema(&json!({})), json!({"type": "object"}));
        assert_eq!(to_gemini_schema(&json!(true)), json!({"type": "object"}));
        assert_eq!(
            to_gemini_schema(&json!({"default": null, "minimum": 0})),
            json!({"type": "object"})
        );
    }

    #[test]
    fn a_union_type_collapses_to_its_first_member() {
        // Genuine unions are not expressible; the first member is closer than
        // dropping the type entirely.
        let converted = to_gemini_schema(&json!({"type": ["string", "number"]}));
        assert_eq!(converted["type"], "string");
        assert!(converted.get("nullable").is_none());

        // A type that is only "null" says nothing the proto can carry.
        assert_eq!(to_gemini_schema(&json!({"type": "null"})), json!({"type": "object"}));
    }

    /// The real MCP tool schemas, not handwritten fixtures — these are what
    /// actually go on the wire, and it was one of them (an `Option<usize>`) that
    /// produced the 400 this conversion exists to prevent.
    #[test]
    fn every_mcp_tool_schema_converts_to_something_the_proto_accepts() {
        let schemas = [
            serde_json::to_value(schemars::schema_for!(
                crate::mcp::tools::read_only::FindJobArgs
            ))
            .unwrap(),
            serde_json::to_value(schemars::schema_for!(
                crate::mcp::tools::read_only::ListJobLogObjectsArgs
            ))
            .unwrap(),
            serde_json::to_value(schemars::schema_for!(
                crate::mcp::tools::read_only::GetJobLogTextArgs
            ))
            .unwrap(),
            serde_json::to_value(schemars::schema_for!(
                crate::mcp::tools::analyze_job_failure::AnalyzeJobFailureArgs
            ))
            .unwrap(),
        ];

        for schema in &schemas {
            let converted = to_gemini_schema(schema);
            assert_no_unsupported_fields(&converted);
        }
    }

    /// Walks a converted schema asserting nothing the proto would reject remains:
    /// no type lists, and no field outside the accepted set.
    fn assert_no_unsupported_fields(schema: &serde_json::Value) {
        const ACCEPTED: [&str; 11] = [
            "description",
            "enum",
            "format",
            "items",
            "maxItems",
            "minItems",
            "nullable",
            "properties",
            "required",
            "title",
            "type",
        ];

        let object = schema.as_object().expect("every schema is an object");
        for (key, value) in object {
            assert!(ACCEPTED.contains(&key.as_str()), "unsupported field {key}");
            // The failure mode was "Proto field is not repeating, cannot start
            // list" — a type must be a single string here.
            if key == "type" {
                assert!(value.is_string(), "type must not be a list: {value}");
            }
        }
        if let Some(properties) = object.get("properties").and_then(|value| value.as_object()) {
            for value in properties.values() {
                assert_no_unsupported_fields(value);
            }
        }
        if let Some(items) = object.get("items") {
            assert_no_unsupported_fields(items);
        }
    }

    #[test]
    fn the_assistant_role_is_called_model_and_calls_carry_no_id() {
        let body = build_request(
            None,
            &[],
            &[Turn::Assistant {
                text: Some("checking".to_string()),
                tool_calls: vec![ChatToolCall {
                    call_id: "c-1".to_string(),
                    tool: "find_job".to_string(),
                    args: json!({"jobId": "abc"}),
                    result: None,
                    error: None,
                    duration_ms: None,
                }],
            }],
        );
        let content = &body["contents"][0];
        assert_eq!(content["role"], "model");
        assert_eq!(content["parts"][0]["text"], "checking");
        let call = &content["parts"][1]["functionCall"];
        assert_eq!(call["name"], "find_job");
        // Args are an object here, not a JSON string.
        assert_eq!(call["args"]["jobId"], "abc");
        assert!(call.get("id").is_none());
    }

    #[test]
    fn an_empty_assistant_turn_is_skipped() {
        // An aborted send leaves a row with neither text nor calls; replaying it
        // would break the role alternation.
        let body = build_request(
            None,
            &[],
            &[Turn::Assistant {
                text: None,
                tool_calls: vec![],
            }],
        );
        assert!(body["contents"].as_array().unwrap().is_empty());
    }

    #[test]
    fn tool_results_reference_the_function_by_name_and_flag_failures() {
        let body = build_request(
            None,
            &[],
            &[
                Turn::ToolResult {
                    call_id: "c-1".to_string(),
                    tool: "find_job".to_string(),
                    content: "{\"id\":\"abc\"}".to_string(),
                    is_error: false,
                },
                Turn::ToolResult {
                    call_id: "c-2".to_string(),
                    tool: "get_job_log_text".to_string(),
                    content: "no such log".to_string(),
                    is_error: true,
                },
            ],
        );
        let ok = &body["contents"][0]["parts"][0]["functionResponse"];
        assert_eq!(body["contents"][0]["role"], "user");
        assert_eq!(ok["name"], "find_job");
        assert_eq!(ok["response"]["result"], "{\"id\":\"abc\"}");

        // The model is told the call failed rather than being handed a blank.
        let failed = &body["contents"][1]["parts"][0]["functionResponse"];
        assert_eq!(failed["response"]["error"], "no such log");
    }

    #[test]
    fn text_frames_become_deltas() {
        let mut folder = StreamFolder::new();
        let events = folder.push_payload(
            r#"{"candidates":[{"content":{"role":"model","parts":[{"text":"the driver "}]}}]}"#,
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("the driver ".to_string())]);
        assert!(!folder.is_finished());
    }

    #[test]
    fn a_function_call_arrives_complete_in_one_frame() {
        let mut folder = StreamFolder::new();
        let events = folder.push_payload(
            r#"{"candidates":[{"content":{"parts":[
                {"functionCall":{"name":"find_job","args":{"jobId":"abc"}}}
            ]}}]}"#,
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::ToolCall {
                call_id,
                tool,
                arguments,
            } => {
                assert_eq!(tool, "find_job");
                assert_eq!(arguments, r#"{"jobId":"abc"}"#);
                // The wire format has no id, so one is minted to correlate the
                // result.
                assert!(!call_id.is_empty());
            }
            other => panic!("expected a tool call, got {other:?}"),
        }
    }

    #[test]
    fn an_argument_less_call_defaults_to_an_empty_object() {
        let mut folder = StreamFolder::new();
        let events = folder
            .push_payload(r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_accounts"}}]}}]}"#);
        assert_eq!(
            events,
            vec![StreamEvent::ToolCall {
                call_id: match &events[0] {
                    StreamEvent::ToolCall { call_id, .. } => call_id.clone(),
                    _ => unreachable!(),
                },
                tool: "list_accounts".to_string(),
                arguments: "{}".to_string(),
            }]
        );
    }

    #[test]
    fn a_finish_reason_ends_the_stream_once() {
        let mut folder = StreamFolder::new();
        let events = folder.push_payload(
            r#"{"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}],
                "usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3}}"#,
        );
        assert_eq!(
            events,
            vec![
                StreamEvent::TextDelta("done".to_string()),
                StreamEvent::Done {
                    stop_reason: Some("STOP".to_string())
                }
            ]
        );
        assert_eq!(folder.usage().input_tokens, Some(12));
        assert_eq!(folder.usage().output_tokens, Some(3));

        // A second terminator must not produce a second Done.
        assert!(folder
            .push_payload(r#"{"candidates":[{"finishReason":"STOP"}]}"#)
            .is_empty());
        assert!(folder.finish(None).is_empty());
    }

    #[test]
    fn an_in_stream_error_ends_the_response_rather_than_being_ignored() {
        let mut folder = StreamFolder::new();
        let events =
            folder.push_payload(r#"{"error":{"code":429,"message":"quota exhausted"}}"#);
        assert_eq!(
            events,
            vec![StreamEvent::Done {
                stop_reason: Some("error: quota exhausted".to_string())
            }]
        );
        assert!(folder.is_finished());
    }

    #[test]
    fn keep_alives_and_junk_frames_are_ignored() {
        let mut folder = StreamFolder::new();
        assert!(folder.push_payload("").is_empty());
        assert!(folder.push_payload("not json").is_empty());
        assert!(folder.push_payload("{}").is_empty());
        assert!(!folder.is_finished());
    }

    #[test]
    fn the_model_id_goes_in_the_path_with_sse_requested() {
        assert_eq!(
            stream_url("https://generativelanguage.googleapis.com/v1beta", "gemini-3.5-flash"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse"
        );
        // A trailing slash on the configured address must not double up.
        assert_eq!(
            stream_url("https://x.example/v1beta/", "m"),
            "https://x.example/v1beta/models/m:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn http_failures_explain_the_likely_cause() {
        let unauthorized = describe_failure(401, r#"{"error":{"message":"bad key"}}"#);
        assert!(unauthorized.contains("API key"), "{unauthorized}");
        assert!(unauthorized.contains("bad key"), "{unauthorized}");

        // The version hint is /v1beta here, not /v1.
        let missing = describe_failure(404, "");
        assert!(missing.contains("/v1beta"), "{missing}");

        let rejected = describe_failure(400, r#"{"error":{"message":"unknown field"}}"#);
        assert!(rejected.contains("unknown field"), "{rejected}");
    }
}
