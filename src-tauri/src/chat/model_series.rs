//! Grouping model ids into series for the LLM Setting model tree.
//!
//! `claude-opus-4-8` → `claude-opus`, `gpt-5.6-sol` → `gpt-5.6`. The rule is a
//! heuristic over hyphen-separated segments: trailing version-looking segments
//! are dropped, and what remains is the series. It is deliberately a guess —
//! the "add model" dialog lets the user override the series, because no rule
//! covers every gateway's naming.
//!
//! Mirrored in `src/services/llmModelSeries.ts` for the frontend; the test
//! cases are kept in sync between the two.

/// True for segments that read as a version rather than part of a name:
/// pure digits (`4`, `8`), dotted numbers (`3.5`), date stamps (`20250219`),
/// and the `latest` / `preview` style suffixes gateways append.
fn is_version_segment(segment: &str) -> bool {
    if segment.is_empty() {
        return false;
    }
    let lower = segment.to_ascii_lowercase();
    if matches!(lower.as_str(), "latest" | "preview" | "beta" | "exp") {
        return true;
    }
    // `4`, `8`, `20250219`, `3.5`, `1.0.2` — digits with optional dots.
    lower.chars().all(|c| c.is_ascii_digit() || c == '.')
        && lower.chars().any(|c| c.is_ascii_digit())
}

/// The series a model id belongs to. Never empty: a model id with nothing but
/// version segments (`gpt-4`) keeps its first segment.
pub fn model_series(model_id: &str) -> String {
    let trimmed = model_id.trim();
    // Gateways often namespace ids as `vendor/model`; the path prefix is not
    // part of the series name users recognise.
    let bare = trimmed.rsplit('/').next().unwrap_or(trimmed);
    let segments: Vec<&str> = bare.split('-').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return trimmed.to_string();
    }

    let mut end = segments.len();
    while end > 1 && is_version_segment(segments[end - 1]) {
        end -= 1;
    }

    segments[..end].join("-")
}

#[cfg(test)]
mod tests {
    use super::model_series;

    #[test]
    fn strips_trailing_version_segments() {
        assert_eq!(model_series("claude-opus-4-8"), "claude-opus");
        assert_eq!(model_series("claude-opus-5"), "claude-opus");
        assert_eq!(model_series("claude-sonnet-4-5-20250929"), "claude-sonnet");
        assert_eq!(model_series("claude-3-7-sonnet-latest"), "claude-3-7-sonnet");
    }

    #[test]
    fn keeps_non_version_suffixes() {
        // `sol` is not a version, so it stays and the series is the whole id.
        assert_eq!(model_series("gpt-5.6-sol"), "gpt-5.6-sol");
        assert_eq!(model_series("gpt-4o-mini"), "gpt-4o-mini");
    }

    #[test]
    fn never_returns_an_empty_series() {
        assert_eq!(model_series("gpt-4"), "gpt");
        assert_eq!(model_series("4"), "4");
        assert_eq!(model_series("o3"), "o3");
    }

    #[test]
    fn drops_gateway_path_prefixes() {
        assert_eq!(model_series("anthropic/claude-opus-4-8"), "claude-opus");
        assert_eq!(model_series("openai/gpt-4o-mini"), "gpt-4o-mini");
    }

    #[test]
    fn tolerates_surrounding_whitespace_and_odd_separators() {
        assert_eq!(model_series("  claude-opus-4-8  "), "claude-opus");
        assert_eq!(model_series("claude--opus--4"), "claude-opus");
    }
}
