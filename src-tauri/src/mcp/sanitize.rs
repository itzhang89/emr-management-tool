//! Log content sanitizer — redacts sensitive patterns before returning to the LLM.
//!
//! Ported from `mcp/src/sanitize/index.ts`. Applied server-side as a final step
//! in every tool that returns log text. Conservative by design: better to
//! over-redact than to miss a sensitive value.

use regex::Regex;

// Lazy-initialized static regexes — compiled once, reused across calls.
fn s3_bucket_re() -> &'static Regex {
    static RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"(?i)s3://([a-z0-9][a-z0-9.-]*[a-z0-9])(?:/|$)").unwrap()
    });
    &RE
}

fn arn_re() -> &'static Regex {
    static RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"\barn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[^\s"'`)\]>,;]+"#).unwrap()
    });
    &RE
}

/// Account ID as a standalone 12-digit number, not part of a larger number.
/// The TS version used a lookbehind (`(?<!\d)`) which Rust's regex crate does
/// not support: we match the pattern and then verify the byte boundaries.
fn account_id_re() -> &'static Regex {
    static RE: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"\d{12}").unwrap());
    &RE
}

fn ip_address_re() -> &'static Regex {
    static RE: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap());
    &RE
}

fn ec2_hostname_re() -> &'static Regex {
    static RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"\bip-\d{1,3}(?:-\d{1,3}){3}\.ec2\.internal\b").unwrap()
    });
    &RE
}

/// FQDN: at least 2 dots, no protocol prefix, not a bare IP address.
fn fqdn_re() -> &'static Regex {
    static RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}\b")
            .unwrap()
    });
    &RE
}

/// Redact standalone 12-digit AWS account IDs. The TS version used a
/// lookbehind (`(?<!\d)`); Rust's regex crate has none, so scan matches and
/// check the neighbouring bytes by hand — a match inside a larger number is
/// left alone.
fn redact_account_ids(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for m in account_id_re().find_iter(text) {
        let start = m.start();
        let end = m.end();
        let prev_is_digit = start > 0 && text.as_bytes()[start - 1].is_ascii_digit();
        let next_is_digit = end < text.len() && text.as_bytes()[end].is_ascii_digit();
        if prev_is_digit || next_is_digit {
            out.push_str(&text[last..end]);
        } else {
            out.push_str(&text[last..start]);
            out.push_str("[AWS_ACCOUNT_ID]");
        }
        last = end;
    }
    out.push_str(&text[last..]);
    out
}

/// Redact sensitive patterns from `text`.
///
/// Order matters: broader patterns first, then more specific. ARN and IP
/// patterns are applied before account-id and hostname checks so that the
/// composite patterns consume the sensitive text first.
pub fn sanitize(text: &str) -> String {
    if text.is_empty() {
        return text.to_string();
    }

    // 1. ARNs — must come before standalone account IDs (ARNs contain them).
    let result = arn_re().replace_all(text, "[ARN]");

    // 2. S3 URIs — redact bucket name, keep scheme.
    let result = s3_bucket_re().replace_all(&result, "s3://[S3_BUCKET]/");

    // 3. Standalone AWS account IDs (12 digits not inside an ARN — already
    //    replaced above — and not part of a larger number).
    let result = redact_account_ids(&result);

    // 4. IPv4 addresses.
    let result = ip_address_re().replace_all(&result, "[IP_ADDRESS]");

    // 5. EC2 internal hostnames.
    let result = ec2_hostname_re().replace_all(&result, "[HOSTNAME]");

    // 6. FQDNs (at least 2 dots).
    let result = fqdn_re().replace_all(&result, "[HOSTNAME]");

    result.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_aws_account_ids() {
        let text = "Running on account 123456789012 with bucket my-bucket";
        let result = sanitize(text);
        assert!(result.contains("[AWS_ACCOUNT_ID]"));
        assert!(!result.contains("123456789012"));
    }

    #[test]
    fn redact_s3_bucket_names() {
        let text = "Uploading to s3://my-data-lake-us-east-1/jobs/abc123/";
        let result = sanitize(text);
        assert!(result.contains("s3://[S3_BUCKET]/"));
        assert!(!result.contains("my-data-lake-us-east-1"));
    }

    #[test]
    fn redact_arns() {
        let text = "Assuming role arn:aws:iam::123456789012:role/EMR_ExecutionRole";
        let result = sanitize(text);
        assert!(result.contains("[ARN]"));
        assert!(!result.contains("123456789012"));
        assert!(!result.contains("EMR_ExecutionRole"));
    }

    #[test]
    fn redact_ip_addresses() {
        let text = "Connecting to 10.0.1.45:8080 and 192.168.1.1:5432";
        let result = sanitize(text);
        assert!(result.contains("[IP_ADDRESS]"));
        assert!(!result.contains("10.0.1.45"));
        assert!(!result.contains("192.168.1.1"));
    }

    #[test]
    fn redact_ec2_internal_hostnames() {
        let text = "Connecting to ip-10-0-1-45.ec2.internal:8080";
        let result = sanitize(text);
        assert!(result.contains("[HOSTNAME]"));
        assert!(!result.contains("ip-10-0-1-45.ec2.internal"));
    }

    #[test]
    fn redact_fqdn_hostnames() {
        let text = "Connecting to my-cluster.us-east-1.elb.amazonaws.com:8080";
        let result = sanitize(text);
        assert!(result.contains("[HOSTNAME]"));
        assert!(!result.contains("my-cluster.us-east-1.elb.amazonaws.com"));
    }

    #[test]
    fn normal_log_message_untouched() {
        let text = "INFO TaskSetManager: Starting task 1 of 10";
        let result = sanitize(text);
        assert_eq!(result, text);
    }

    #[test]
    fn multiple_redactions_in_one_line() {
        let text = "Running on 123456789012 at 10.0.1.45, using arn:aws:iam::123456789012:role/R1 and s3://my-bucket/jobs/abc";
        let result = sanitize(text);
        assert!(result.contains("[AWS_ACCOUNT_ID]"));
        assert!(result.contains("[IP_ADDRESS]"));
        assert!(result.contains("[ARN]"));
        assert!(result.contains("s3://[S3_BUCKET]/"));
    }

    #[test]
    fn empty_text() {
        assert_eq!(sanitize(""), "");
    }

    #[test]
    fn no_sensitive_data() {
        let text = "INFO MyLogger: Processing data successfully";
        let result = sanitize(text);
        assert_eq!(result, text);
    }

    #[test]
    fn no_false_positive_on_normal_numbers() {
        let text = "INFO TaskSchedulerImpl: Starting 42 tasks with 10 stages";
        let result = sanitize(text);
        assert_eq!(result, text);
    }

    #[test]
    fn sql_log_line_with_s3() {
        let text = "SELECT * FROM s3://data-bucket/sales WHERE region = 'us-east-1'";
        let result = sanitize(text);
        assert!(result.contains("s3://[S3_BUCKET]/"));
        assert!(!result.contains("data-bucket"));
    }

    #[test]
    fn mixed_spark_error() {
        let text = "ERROR SparkException: Job aborted: Task failed due to s3://etl-output-bucket/part-00000 and ip-10-0-1-100.ec2.internal";
        let result = sanitize(text);
        assert!(result.contains("s3://[S3_BUCKET]/"));
        assert!(!result.contains("etl-output-bucket"));
        assert!(result.contains("[HOSTNAME]"));
        assert!(!result.contains("ip-10-0-1-100.ec2.internal"));
    }
}
