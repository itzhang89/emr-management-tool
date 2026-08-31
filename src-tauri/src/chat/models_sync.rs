//! Listing the models an endpoint advertises.
//!
//! Used by both `test_llm_provider` (reaching `/models` at all proves the base
//! URL and key work) and `sync_llm_models` (the listing becomes import
//! candidates). The request happens in Rust because the API key must not enter
//! the WebView.

use crate::chat::model_series::model_series;
use crate::error::{AppError, AppResult};
use crate::models::{LlmModelCandidate, LlmProtocol};
use std::collections::BTreeMap;
use std::time::Duration;

/// Gateways that return their whole catalogue can list hundreds of models. The
/// import dialog is a multi-select over this list, so it is capped rather than
/// allowed to grow without bound.
const MAX_CANDIDATES: usize = 500;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// `GET {base_url}/models`, authenticated per the endpoint's protocol.
///
/// All three shapes list at the same path — Gemini's default base URL includes
/// `/v1beta` precisely so that stays true — but they answer with different
/// bodies, so the parser is chosen by protocol.
pub async fn list_models(
    protocol: LlmProtocol,
    base_url: &str,
    api_key: &str,
    headers: &BTreeMap<String, String>,
) -> AppResult<Vec<LlmModelCandidate>> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| AppError::internal(error.to_string()))?;

    let mut request = match protocol {
        LlmProtocol::Openai => client.get(&url).bearer_auth(api_key),
        LlmProtocol::Anthropic => client
            .get(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
        LlmProtocol::Gemini => client.get(&url).header("x-goog-api-key", api_key),
    };
    for (name, value) in headers {
        request = request.header(name, value);
    }

    let response = request.send().await.map_err(|error| {
        // Network-level failures are the common case when a base URL is wrong,
        // so the message keeps the URL visible.
        AppError::internal(format!("Could not reach {url}: {error}"))
    })?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        // Tagged when it is an auth failure, so a caller holding several keys can
        // retire the one it used and try the next.
        return Err(crate::chat::protocol::http_failure(
            status.as_u16(),
            describe_http_failure(protocol, status.as_u16(), &body),
        ));
    }

    match protocol {
        LlmProtocol::Gemini => parse_gemini_model_list(&body),
        _ => parse_model_list(&body),
    }
}

/// Turns a failed listing into something actionable. A 401 from a gateway is
/// almost always a wrong key, and a 404 almost always a base URL that already
/// includes or omits the version segment.
fn describe_http_failure(protocol: LlmProtocol, status: u16, body: &str) -> String {
    let detail = extract_error_message(body)
        .map(|message| format!(" {message}"))
        .unwrap_or_default();
    // The version segment differs, so the hint has to name the right one.
    let version_segment = match protocol {
        LlmProtocol::Gemini => "/v1beta",
        _ => "/v1",
    };
    match status {
        401 | 403 => format!("Authentication failed ({status}). Check the API key.{detail}"),
        404 => format!(
            "No model list at this address ({status}). Check whether the base URL should include {version_segment}.{detail}"
        ),
        429 => format!("Rate limited by the provider ({status}).{detail}"),
        _ => format!("The provider returned HTTP {status}.{detail}"),
    }
}

/// Pulls `error.message` out of an error body, which both shapes use.
fn extract_error_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let message = value
        .get("error")
        .and_then(|error| error.get("message"))
        .or_else(|| value.get("message"))?
        .as_str()?
        .trim();
    if message.is_empty() {
        return None;
    }
    // Provider error text can be long; it is a hint, not the whole story.
    Some(message.chars().take(300).collect())
}

/// Parses `{"data": [{"id": "..."}]}` into candidates, keeping the response
/// order and dropping duplicates. `already_added` is filled in by the caller,
/// which is the side that knows what is stored.
///
/// Token limits are left `None`: the OpenAI and Anthropic listings do not report
/// them consistently enough across gateways to be worth guessing at.
fn parse_model_list(body: &str) -> AppResult<Vec<LlmModelCandidate>> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|error| {
        AppError::validation(format!(
            "The provider's model list was not valid JSON: {error}"
        ))
    })?;

    // Most gateways nest under `data`; a few return a bare array.
    let entries = value
        .get("data")
        .and_then(|data| data.as_array())
        .or_else(|| value.as_array())
        .ok_or_else(|| {
            AppError::validation(
                "The provider's model list had no \"data\" array. Add models manually instead.",
            )
        })?;

    let mut seen = std::collections::HashSet::new();
    let mut candidates = Vec::new();
    for entry in entries {
        let Some(model_id) = entry
            .get("id")
            .and_then(|id| id.as_str())
            .or_else(|| entry.as_str())
            .map(str::trim)
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if !seen.insert(model_id.to_string()) {
            continue;
        }
        candidates.push(LlmModelCandidate {
            series: model_series(model_id),
            model_id: model_id.to_string(),
            display_name: entry
                .get("display_name")
                .and_then(|name| name.as_str())
                .map(ToString::to_string),
            context_window: None,
            max_input_tokens: None,
            max_output_tokens: None,
            already_added: false,
        });
        if candidates.len() >= MAX_CANDIDATES {
            break;
        }
    }

    finish_candidates(candidates)
}

/// Parses the Gemini listing: `{"models": [{"name": "models/…", …}]}`.
///
/// This is the one shape that reports token limits honestly, so they are carried
/// through and land in the database on import — the other two leave the fields
/// for the user to fill in by hand.
fn parse_gemini_model_list(body: &str) -> AppResult<Vec<LlmModelCandidate>> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|error| {
        AppError::validation(format!(
            "The provider's model list was not valid JSON: {error}"
        ))
    })?;

    let entries = value
        .get("models")
        .and_then(|models| models.as_array())
        .ok_or_else(|| {
            AppError::validation(
                "The provider's model list had no \"models\" array. Add models manually instead.",
            )
        })?;

    let mut seen = std::collections::HashSet::new();
    let mut candidates = Vec::new();
    for entry in entries {
        let Some(model_id) = entry
            .get("name")
            .and_then(|name| name.as_str())
            .map(str::trim)
            // Ids come back path-qualified as "models/gemini-3.5-flash", but the
            // value the API expects in a request is the bare id.
            .map(|name| name.strip_prefix("models/").unwrap_or(name))
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if !seen.insert(model_id.to_string()) {
            continue;
        }

        let input_limit = entry.get("inputTokenLimit").and_then(|v| v.as_i64());
        candidates.push(LlmModelCandidate {
            series: model_series(model_id),
            model_id: model_id.to_string(),
            display_name: entry
                .get("displayName")
                .and_then(|name| name.as_str())
                .map(ToString::to_string),
            // The input limit *is* the context window for this API; it reports
            // one number, so both fields get it rather than one being invented.
            context_window: input_limit,
            max_input_tokens: input_limit,
            max_output_tokens: entry.get("outputTokenLimit").and_then(|v| v.as_i64()),
            already_added: false,
        });
        if candidates.len() >= MAX_CANDIDATES {
            break;
        }
    }

    finish_candidates(candidates)
}

/// A listing that parsed but named nothing usable is a failure, not an empty
/// result: the user needs to be told to add models by hand.
fn finish_candidates(candidates: Vec<LlmModelCandidate>) -> AppResult<Vec<LlmModelCandidate>> {
    if candidates.is_empty() {
        return Err(AppError::validation(
            "The provider reported no models. Add them manually instead.",
        ));
    }
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_openai_shaped_listing() {
        let body = r#"{"object":"list","data":[
            {"id":"gpt-4o","object":"model"},
            {"id":"claude-opus-4-8","display_name":"Opus 4.8"}
        ]}"#;
        let models = parse_model_list(body).expect("parses");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].model_id, "gpt-4o");
        assert_eq!(models[0].series, "gpt-4o");
        assert_eq!(models[1].series, "claude-opus");
        assert_eq!(models[1].display_name.as_deref(), Some("Opus 4.8"));
        // The caller marks what is already stored; the parser never guesses.
        assert!(!models[1].already_added);
    }

    #[test]
    fn accepts_a_bare_array_and_drops_duplicates() {
        let body = r#"[{"id":"o3"},{"id":"o3"},{"id":"  "},{"id":"gpt-4o-mini"}]"#;
        let models = parse_model_list(body).expect("parses");
        let ids: Vec<&str> = models.iter().map(|m| m.model_id.as_str()).collect();
        assert_eq!(ids, vec!["o3", "gpt-4o-mini"]);
    }

    #[test]
    fn rejects_a_listing_with_nothing_usable() {
        assert!(parse_model_list(r#"{"data":[]}"#).is_err());
        assert!(parse_model_list(r#"{"models":["a"]}"#).is_err());
        assert!(parse_model_list("not json").is_err());
    }

    #[test]
    fn parses_the_gemini_shaped_listing_with_its_token_limits() {
        let body = r#"{"models":[
            {"name":"models/gemini-3.5-flash","displayName":"Gemini 3.5 Flash",
             "inputTokenLimit":1048576,"outputTokenLimit":65536},
            {"name":"models/gemini-flash-latest","displayName":"Gemini Flash Latest"}
        ]}"#;
        let models = parse_gemini_model_list(body).expect("parses");
        assert_eq!(models.len(), 2);
        // The path prefix is stripped: the bare id is what a request wants.
        assert_eq!(models[0].model_id, "gemini-3.5-flash");
        // `flash` is not a version segment, so the inferred group keeps it. This
        // is why the edit dialog lets the group be overridden — a user who wants
        // every Gemini model under one "Gemini" heading sets it by hand.
        assert_eq!(models[0].series, "gemini-3.5-flash");
        assert_eq!(models[1].series, "gemini-flash");
        assert_eq!(models[0].display_name.as_deref(), Some("Gemini 3.5 Flash"));
        // This is the one shape that reports limits, so they are carried through.
        assert_eq!(models[0].context_window, Some(1_048_576));
        assert_eq!(models[0].max_input_tokens, Some(1_048_576));
        assert_eq!(models[0].max_output_tokens, Some(65_536));
        // A model that omits them is left blank rather than guessed at.
        assert_eq!(models[1].context_window, None);
        assert_eq!(models[1].max_output_tokens, None);
    }

    #[test]
    fn the_gemini_parser_drops_duplicates_and_rejects_the_other_shape() {
        let body = r#"{"models":[{"name":"models/a"},{"name":"models/a"},{"name":"  "},{"name":"b"}]}"#;
        let models = parse_gemini_model_list(body).expect("parses");
        let ids: Vec<&str> = models.iter().map(|m| m.model_id.as_str()).collect();
        // An unprefixed name is taken as-is.
        assert_eq!(ids, vec!["a", "b"]);

        // The OpenAI envelope has no "models" array, so it is a clear failure
        // rather than a silent empty list.
        assert!(parse_gemini_model_list(r#"{"data":[{"id":"gpt-4o"}]}"#).is_err());
        assert!(parse_gemini_model_list(r#"{"models":[]}"#).is_err());
    }

    #[test]
    fn the_gemini_parser_caps_large_catalogues_too() {
        let entries: Vec<String> = (0..MAX_CANDIDATES + 50)
            .map(|index| format!(r#"{{"name":"models/model-x{index}"}}"#))
            .collect();
        let body = format!(r#"{{"models":[{}]}}"#, entries.join(","));
        assert_eq!(
            parse_gemini_model_list(&body).expect("parses").len(),
            MAX_CANDIDATES
        );
    }

    #[test]
    fn caps_very_large_catalogues() {
        let entries: Vec<String> = (0..MAX_CANDIDATES + 50)
            .map(|index| format!(r#"{{"id":"model-x{index}"}}"#))
            .collect();
        let body = format!(r#"{{"data":[{}]}}"#, entries.join(","));
        let models = parse_model_list(&body).expect("parses");
        assert_eq!(models.len(), MAX_CANDIDATES);
    }

    #[test]
    fn http_failures_explain_the_likely_cause() {
        let unauthorized =
            describe_http_failure(LlmProtocol::Openai, 401, r#"{"error":{"message":"bad key"}}"#);
        assert!(unauthorized.contains("API key"), "{unauthorized}");
        assert!(unauthorized.contains("bad key"), "{unauthorized}");

        let missing = describe_http_failure(LlmProtocol::Openai, 404, "");
        assert!(missing.contains("/v1"), "{missing}");

        // Gemini's paths are versioned differently, so the hint must differ too.
        let gemini_missing = describe_http_failure(LlmProtocol::Gemini, 404, "");
        assert!(gemini_missing.contains("/v1beta"), "{gemini_missing}");

        let other = describe_http_failure(LlmProtocol::Anthropic, 500, "oops");
        assert!(other.contains("500"), "{other}");
    }

    #[test]
    fn error_messages_are_extracted_from_either_shape() {
        assert_eq!(
            extract_error_message(r#"{"error":{"message":"nope"}}"#).as_deref(),
            Some("nope")
        );
        assert_eq!(
            extract_error_message(r#"{"message":"flat"}"#).as_deref(),
            Some("flat")
        );
        assert_eq!(extract_error_message(r#"{"error":{}}"#), None);
        assert_eq!(extract_error_message("plain text"), None);
    }
}
