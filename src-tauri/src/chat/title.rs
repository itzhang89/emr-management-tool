//! Naming a conversation from its first message.
//!
//! A sidebar full of "New conversation" is unusable, so the first exchange earns
//! the session its name. The model is asked for a title because a truncated
//! question reads badly once someone pastes a stack trace — but that truncation
//! is the fallback, so an offline or failing provider still produces something
//! better than the default.

use super::session::ResolvedTarget;
use super::protocol::{StreamEvent, Turn};
use crate::models::LlmProviderKind;

/// Titles are shown in a narrow sidebar column, so anything longer is noise.
const MAX_TITLE_CHARS: usize = 48;

/// Enough for a title and nothing more. Only the Anthropic shape takes this —
/// gateways disagree about which field the OpenAI shape wants it in.
const MAX_TITLE_TOKENS: i64 = 32;

/// The first message can be an entire stack trace; only its opening matters for
/// naming, and a smaller request is cheaper and faster.
const MAX_PROMPT_CHARS: usize = 2_000;

const TITLE_SYSTEM_PROMPT: &str = "\
You name chat conversations. Answer with a title of at most six words describing \
what the user is asking about, keeping any job id, cluster name, or error term \
from their message. No quotes, no trailing punctuation, no explanation — the \
title alone.";

/// Asks the model for a title, falling back to the message itself.
///
/// Never fails: a conversation that could not be named keeps the fallback title,
/// which is worse than a good title but better than blocking the send.
pub async fn generate(
    target: &ResolvedTarget,
    first_message: &str,
    cancel: &tokio_util::sync::CancellationToken,
) -> String {
    let fallback = fallback_title(first_message);

    // A user who just pressed stop does not want another request issued on their
    // behalf, and a cancelled token would abort this one immediately anyway.
    if cancel.is_cancelled() {
        return fallback;
    }

    let turns = [Turn::User {
        text: condense(first_message, MAX_PROMPT_CHARS),
    }];
    let mut streamed = String::new();
    let mut collect = |event: StreamEvent| {
        if let StreamEvent::TextDelta(text) = event {
            streamed.push_str(&text);
        }
    };

    // No tools: naming needs nothing from AWS, and advertising them invites the
    // model to start an investigation instead of answering.
    let outcome = match target.kind {
        LlmProviderKind::Openai => {
            let body = super::openai::build_request(
                &target.model_id,
                Some(TITLE_SYSTEM_PROMPT),
                &[],
                &turns,
            );
            super::openai::stream_response(
                &target.base_url,
                &target.api_key,
                &body,
                cancel,
                &mut collect,
            )
            .await
        }
        LlmProviderKind::Anthropic => {
            let body = super::anthropic::build_request(
                &target.model_id,
                Some(TITLE_SYSTEM_PROMPT),
                &[],
                &turns,
                Some(MAX_TITLE_TOKENS),
            );
            super::anthropic::stream_response(
                &target.base_url,
                &target.api_key,
                &body,
                cancel,
                &mut collect,
            )
            .await
        }
    };

    match outcome {
        Ok(_) => clean_title(&streamed).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

/// The title to use when the model cannot supply one: the message's own opening.
pub fn fallback_title(first_message: &str) -> String {
    let condensed = condense(first_message, MAX_TITLE_CHARS);
    if condensed.is_empty() {
        // Only reachable for whitespace-only input, which `chat_send` rejects.
        "New conversation".to_string()
    } else {
        condensed
    }
}

/// Turns a model's answer into a title, or `None` when it said nothing usable.
///
/// Models wrap titles in quotes, prefix them with "Title:", and add a full stop
/// however firmly they are told not to, so the answer is trimmed rather than
/// trusted.
fn clean_title(answer: &str) -> Option<String> {
    let mut text = answer.trim();
    for prefix in ["Title:", "title:", "TITLE:"] {
        if let Some(rest) = text.strip_prefix(prefix) {
            text = rest.trim();
        }
    }
    let text = text.trim_matches(|character| matches!(character, '"' | '\'' | '`' | '*'));
    let text = text.trim_end_matches(['.', '。', '!', '?']);

    let title = condense(text, MAX_TITLE_CHARS);
    (!title.is_empty()).then_some(title)
}

/// First line, collapsed whitespace, capped length. Shared by both paths so a
/// model answer and a raw message are shortened the same way.
fn condense(text: &str, limit: usize) -> String {
    let first_line = text.lines().find(|line| !line.trim().is_empty()).unwrap_or("");
    let collapsed = first_line.split_whitespace().collect::<Vec<_>>().join(" ");

    if collapsed.chars().count() <= limit {
        return collapsed;
    }
    // The ellipsis says the title was cut, so a truncated job id is not mistaken
    // for the whole thing.
    let kept: String = collapsed.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", kept.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_question_becomes_the_title_unchanged() {
        assert_eq!(fallback_title("why did job-abc fail?"), "why did job-abc fail?");
    }

    #[test]
    fn only_the_first_line_of_a_pasted_trace_is_used() {
        let title = fallback_title(
            "why did this fail?\n\njava.lang.OutOfMemoryError\n\tat org.apache.spark...",
        );
        assert_eq!(title, "why did this fail?");
    }

    #[test]
    fn a_long_first_line_is_cut_with_an_ellipsis() {
        let title = fallback_title(&"a".repeat(200));
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
        // Silent truncation would let a cut job id read as a whole one.
        assert!(title.ends_with('…'));
    }

    #[test]
    fn runs_of_whitespace_collapse() {
        assert_eq!(fallback_title("  job   abc \t failed  "), "job abc failed");
    }

    #[test]
    fn whitespace_only_input_keeps_the_default_name() {
        assert_eq!(fallback_title("   \n  "), "New conversation");
    }

    #[test]
    fn a_models_decorations_are_stripped() {
        assert_eq!(
            clean_title("  \"Job abc out-of-memory failure.\"  ").as_deref(),
            Some("Job abc out-of-memory failure")
        );
        assert_eq!(
            clean_title("Title: Shuffle spill on job-xyz").as_deref(),
            Some("Shuffle spill on job-xyz")
        );
        assert_eq!(clean_title("**Driver OOM**").as_deref(), Some("Driver OOM"));
    }

    #[test]
    fn an_answer_with_no_content_produces_no_title() {
        // The caller falls back to the message rather than storing an empty name.
        assert_eq!(clean_title("   "), None);
        assert_eq!(clean_title("\"\""), None);
    }

    #[test]
    fn a_multi_line_answer_keeps_only_its_first_line() {
        assert_eq!(
            clean_title("Driver OOM on job-abc\n\nThis title summarises...").as_deref(),
            Some("Driver OOM on job-abc")
        );
    }

    #[test]
    fn a_long_model_answer_is_capped_like_the_fallback() {
        let title = clean_title(&"word ".repeat(40)).expect("a title");
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
    }
}