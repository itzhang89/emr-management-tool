//! EMR on EKS job run id validation.
//!
//! Ported from `mcp/src/tools/emrJobId.ts`. The MCP tool refuses anything that
//! is not a plausible EMR job id rather than spending a cross-account search on
//! it — a truncated or hallucinated id must come back to the caller as a
//! correction request, not as "job not found".

/// `"spark-<id>"` and a bare `"<id>"` address the same job. The prefix strip is
/// case-insensitive, matching the TS `replace(/^spark-/i, "")`.
pub fn normalize(value: &str) -> String {
    let trimmed = value.trim();
    let stripped = trimmed
        .get(6..)
        .filter(|_| trimmed[..6].eq_ignore_ascii_case("spark-"))
        .unwrap_or(trimmed);
    stripped.trim().to_string()
}

/// EMR on EKS ids are opaque lowercase alphanumeric strings (19 chars in
/// practice); `job-…` is accepted for the classic EMR form. The width bound is
/// what rejects a truncated id, which is the common failure mode when a model
/// copies the id out of a prompt.
pub fn is_likely_emr_job_run_id(value: &str) -> bool {
    let normalized = normalize(value);
    let classic = regex::Regex::new(r"^job-[A-Za-z0-9-]+$").unwrap();
    let modern = regex::Regex::new(r"^[a-z0-9]{16,64}$").unwrap();
    classic.is_match(&normalized) || modern.is_match(&normalized)
}

/// Human-readable reason an id was rejected, for the tool's error payload.
pub fn describe_invalid_job_id(value: &str) -> String {
    let normalized = normalize(value);
    if normalized.is_empty() {
        return "The job id is empty.".to_string();
    }
    if normalized.chars().any(char::is_whitespace) {
        return "The job id contains whitespace — pass a single job id with no surrounding text.".to_string();
    }
    if normalized.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && normalized.len() < 16
    {
        return format!(
            "The job id \"{normalized}\" is only {} characters; EMR on EKS job ids are at least 16. It looks truncated — supply the complete id.",
            normalized.len()
        );
    }
    if normalized.chars().any(|c| c.is_ascii_uppercase()) && !normalized.starts_with("job-") {
        return format!(
            "The job id \"{normalized}\" contains uppercase characters; EMR on EKS job ids are lowercase alphanumeric."
        );
    }
    format!(
        "\"{normalized}\" is not a valid EMR job run id. Expected a lowercase alphanumeric id of 16-64 characters (optionally prefixed with \"spark-\"), or a \"job-…\" id."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_spark_prefix_and_whitespace() {
        assert_eq!(normalize(" spark-0000000381t77o3g8f5 "), "0000000381t77o3g8f5");
        assert_eq!(normalize("0000000381t77o3g8f5"), "0000000381t77o3g8f5");
        assert_eq!(normalize("Spark-abc"), "abc");
        assert_eq!(normalize("  spark-  abc  "), "abc");
    }

    #[test]
    fn accepts_valid_ids() {
        assert!(is_likely_emr_job_run_id("0000000381t77o3g8f5"));
        assert!(is_likely_emr_job_run_id("spark-0000000381t77o3g8f5"));
        assert!(is_likely_emr_job_run_id("job-12345-ABC-def"));
        assert!(is_likely_emr_job_run_id("aaaaaaaaaaaaaaaa"));
    }

    #[test]
    fn rejects_truncated_ids() {
        assert!(!is_likely_emr_job_run_id("0000000381t77"));
        assert!(!is_likely_emr_job_run_id(""));
    }

    /// Surrounding whitespace is trimmed before validation (the TS original
    /// normalizes first), so a padded but otherwise complete id is accepted.
    #[test]
    fn accepts_a_padded_id() {
        assert!(is_likely_emr_job_run_id("0000000381t77o3g8f5 "));
    }

    #[test]
    fn rejects_whitespace_and_uppercase() {
        assert!(!is_likely_emr_job_run_id("0000 000381t77o3g8f5"));
        assert!(!is_likely_emr_job_run_id("0000000381T77O3G8F5"));
    }

    #[test]
    fn describes_rejection_reasons() {
        assert!(describe_invalid_job_id("").contains("empty"));
        assert!(describe_invalid_job_id("a b").contains("whitespace"));
        assert!(describe_invalid_job_id("short").contains("at least 16"));
        assert!(describe_invalid_job_id("ABC123").contains("uppercase"));
        assert!(describe_invalid_job_id("!!!" ).contains("not a valid EMR job run id"));
    }
}