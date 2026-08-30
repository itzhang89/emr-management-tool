//! Listing the models an endpoint advertises.
//!
//! Used by both `test_llm_endpoint` (reaching `/models` at all proves the base
//! URL and key work) and `sync_llm_models` (the listing becomes import
//! candidates). The request happens in Rust because the API key must not enter
//! the WebView.

use crate::chat::model_series::model_series;
use crate::error::{AppError, AppResult};
use crate::models::{LlmModelCandidate, LlmProviderKind};
use std::time::Duration;

/// Gateways that return their whole catalogue can list hundreds of models. The
/// import dialog is a multi-select over this list, so it is capped rather than
/// allowed to grow without bound.
const MAX_CANDIDATES: usize = 500;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// `GET {base_url}/models`, authenticated per the provider's shape.
///
/// Both shapes answer with `{"data": [{"id": ...}]}`, so one parser covers them;
/// only the auth headers differ. Anything else in the body is ignored — context
/// windows are not reported consistently enough across gateways to rely on.
pub async fn list_models(
    kind: LlmProviderKind,
    base_url: &str,
    api_key: &str,
) -> AppResult<Vec<LlmModelCandidate>> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| AppError::internal(error.to_string()))?;

    let request = match kind {
        LlmProviderKind::Openai => client.get(&url).bearer_auth(api_key),
        LlmProviderKind::Anthropic => client
            .get(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
    };

    let response = request.send().await.map_err(|error| {
        // Network-level failures are the common case when a base URL is wrong,
        // so the message keeps the URL visible.
        AppError::internal(format!("Could not reach {url}: {error}"))
    })?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::validation(describe_http_failure(
            status.as_u16(),
            &body,
        )));
    }

    parse_model_list(&body)
}

/// Turns a failed listing into something actionable. A 401 from a gateway is
/// almost always a wrong key, and a 404 almost always a base URL that already
/// includes or omits `/v1`.
fn describe_http_failure(status: u16, body: &str) -> String {
    let detail = extract_error_message(body)
        .map(|message| format!(" {message}"))
        .unwrap_or_default();
    match status {
        401 | 403 => format!("Authentication failed ({status}). Check the API key.{detail}"),
        404 => format!(
            "No model list at this address ({status}). Check whether the base URL should include /v1.{detail}"
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
            already_added: false,
        });
        if candidates.len() >= MAX_CANDIDATES {
            break;
        }
    }

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
        let unauthorized = describe_http_failure(401, r#"{"error":{"message":"bad key"}}"#);
        assert!(unauthorized.contains("API key"), "{unauthorized}");
        assert!(unauthorized.contains("bad key"), "{unauthorized}");

        let missing = describe_http_failure(404, "");
        assert!(missing.contains("/v1"), "{missing}");

        let other = describe_http_failure(500, "oops");
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
