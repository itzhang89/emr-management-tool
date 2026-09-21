//! Log content sanitizer — redacts sensitive patterns before returning to the LLM.
//!
//! Ported from `mcp/src/sanitize/index.ts`. Applied server-side as a final step
//! in every tool that returns log text. Conservative by design: better to
//! over-redact than to miss a sensitive value.
//!
//! Redaction is **configurable**: which built-in rules run is a per-rule on/off
//! switch, and the user may add generic `pattern → replacement` custom rules.
//! The engine reads the process-global compiled rules — all six built-ins
//! (enabled) plus any enabled custom rules — as a snapshot so repeated calls on
//! large logs share one compile. [`sanitize`] uses that snapshot and is
//! byte-identical to the original behaviour until a config is loaded via
//! [`load_rules`].

use regex::Regex;
use std::sync::{Arc, Mutex, OnceLock};

use crate::models::{RedactRule, RedactRuleKind};

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

// ---------------------------------------------------------------------------
// Built-in rule descriptors (fixed; enable-only in the UI)
// ---------------------------------------------------------------------------

/// The built-in redaction rules. Each has a stable slug used as its stored DB
/// `id`, a display name, a fixed category group, and a function that applies it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltinRule {
    Arn,
    S3Bucket,
    AccountId,
    Ipv4,
    Ec2Hostname,
    Fqdn,
}

impl BuiltinRule {
    /// Canonical application order. Broader patterns apply first, consuming the
    /// text so more-specific later rules (hostname, account-id) do not re-match
    /// inside an already-masked span.
    pub const ALL: [BuiltinRule; 6] = [
        BuiltinRule::Arn,
        BuiltinRule::S3Bucket,
        BuiltinRule::AccountId,
        BuiltinRule::Ipv4,
        BuiltinRule::Ec2Hostname,
        BuiltinRule::Fqdn,
    ];

    pub const fn slug(self) -> &'static str {
        match self {
            BuiltinRule::Arn => "arn",
            BuiltinRule::S3Bucket => "s3-bucket",
            BuiltinRule::AccountId => "account-id",
            BuiltinRule::Ipv4 => "ipv4",
            BuiltinRule::Ec2Hostname => "ec2-host",
            BuiltinRule::Fqdn => "fqdn",
        }
    }

    pub const fn display_name(self) -> &'static str {
        match self {
            BuiltinRule::Arn => "AWS ARN",
            BuiltinRule::S3Bucket => "S3 bucket (keeps s3://)",
            BuiltinRule::AccountId => "AWS account id",
            BuiltinRule::Ipv4 => "IPv4 address",
            BuiltinRule::Ec2Hostname => "EC2 internal hostname",
            BuiltinRule::Fqdn => "FQDN hostname",
        }
    }

    /// Category group shown in the panel.
    pub const fn category(self) -> &'static str {
        match self {
            BuiltinRule::Arn | BuiltinRule::AccountId => "secret",
            BuiltinRule::S3Bucket
            | BuiltinRule::Ipv4
            | BuiltinRule::Ec2Hostname
            | BuiltinRule::Fqdn => "network",
        }
    }

    pub fn from_slug(slug: &str) -> Option<BuiltinRule> {
        BuiltinRule::ALL
            .iter()
            .copied()
            .find(|rule| rule.slug() == slug)
    }
}

/// One rule drawn from config.
#[derive(Debug, Clone)]
enum RuleSpec {
    Builtin { rule: BuiltinRule, enabled: bool },
    Custom(CompiledCustom),
}

/// A compiled custom rule (`pattern` compiled to a regex when valid).
#[derive(Debug, Clone)]
struct CompiledCustom {
    name: String,
    regex: Option<Regex>,
    /// Mask macro (`__MASK_ALL__`, `__KEEP_HEAD_TAIL_..__`) or a literal.
    replacement: String,
}

/// The immutable, precompiled result of compiling the current rules. Shared by
/// reference across the repeated `sanitize` calls within one tool invocation.
#[derive(Debug, Clone)]
pub struct RuleSet {
    specs: Vec<RuleSpec>,
}

/// Process-global rules that [`sanitize`] applies, replaced wholesale by
/// [`load_rules`]. Defaults to all six built-ins enabled.
static CURRENT_RULES: OnceLock<Mutex<Arc<RuleSet>>> = OnceLock::new();

fn current_rules() -> &'static Mutex<Arc<RuleSet>> {
    CURRENT_RULES.get_or_init(|| Mutex::new(Arc::new(default_rules())))
}

fn default_rules() -> RuleSet {
    RuleSet {
        specs: BuiltinRule::ALL
            .iter()
            .map(|rule| RuleSpec::Builtin {
                rule: *rule,
                enabled: true,
            })
            .collect(),
    }
}

/// The six built-ins as models with every rule enabled — the canonical seed used
/// for the DB default set and for `default_rules`.
pub fn default_rule_models() -> Vec<RedactRule> {
    BuiltinRule::ALL
        .iter()
        .enumerate()
        .map(|(index, rule)| RedactRule {
            id: rule.slug().to_string(),
            name: rule.display_name().to_string(),
            category: rule.category().to_string(),
            pattern: None,
            replacement: None,
            sample: None,
            enabled: true,
            kind: RedactRuleKind::Builtin,
            sort_order: index as i64,
        })
        .collect()
}

/// Compile a list of rules into the runnable [`RuleSet`]. Built-ins are matched
/// by slug and honour their `enabled` flag; custom rules follow in `sort_order`
/// order. A stored list would normally carry every built-in row, but an entry
/// missing a built-in leaves it enabled so behaviour before the feature is
/// preserved on upgrade.
fn compile_rules(rules: &[RedactRule]) -> RuleSet {
    let mut specs: Vec<RuleSpec> = BuiltinRule::ALL
        .iter()
        .map(|builtin| {
            let enabled = rules
                .iter()
                .any(|rule| {
                    rule.enabled && rule.kind == RedactRuleKind::Builtin && rule.id == builtin.slug()
                })
                // A built-in absent from the list (rather than disabled) is on.
                || !rules
                    .iter()
                    .any(|rule| rule.kind == RedactRuleKind::Builtin && rule.id == builtin.slug());
            RuleSpec::Builtin { rule: *builtin, enabled }
        })
        .collect();

    for rule in rules {
        if rule.kind != RedactRuleKind::Custom || !rule.enabled {
            continue;
        }
        specs.push(RuleSpec::Custom(CompiledCustom {
            name: rule.name.clone(),
            regex: rule
                .pattern
                .as_deref()
                .and_then(|pattern| Regex::new(pattern).ok()),
            replacement: rule.replacement.clone().unwrap_or_default(),
        }));
    }

    specs.sort_by_key(|spec| match spec {
        RuleSpec::Builtin { .. } => 0, // always precede customs, in canonical order
        RuleSpec::Custom(_) => 1,
    });

    RuleSet { specs }
}

/// Make `rules` the process-global set applied by [`sanitize`], so the change is
/// visible from the next tool call. Called by the save command after persisting.
pub fn load_rules(rules: &[RedactRule]) {
    let compiled = compile_rules(rules);
    if let Ok(mut guard) = current_rules().lock() {
        *guard = Arc::new(compiled);
    }
}

/// Reset the process-global set to defaults.
pub fn reset_rules() {
    load_rules(&default_rule_models());
}

/// Redact sensitive patterns from `text` using the current process-global rules.
pub fn sanitize(text: &str) -> String {
    let snapshot = current_snapshot();
    run(&snapshot, text).text
}

/// A compiled-default rule set, used when the global mutex is poisoned (a rare
/// panic-in-lock path that must not turn log reads into a crash) — in practice
/// the same as the unconfigured default.
static DEFAULT_SNAPSHOT: OnceLock<Arc<RuleSet>> = OnceLock::new();

fn current_snapshot() -> Arc<RuleSet> {
    match current_rules().lock() {
        Ok(guard) => guard.clone(),
        Err(_) => Arc::clone(DEFAULT_SNAPSHOT.get_or_init(|| Arc::new(default_rules()))),
    }
}

/// The result of running a rule set over text: the masked output, the names of
/// every rule that replaced at least one span, and how many spans in total were
/// replaced across all rules.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct RedactOutcome {
    pub text: String,
    pub hits: Vec<String>,
    pub count: usize,
}

/// Run an explicit rule set over `text`. Used by the batch-test command, which
/// supplies the panel's local (unsaved) rules so the result matches the preview.
pub fn sanitize_with_rules(text: &str, rules: &[RedactRule]) -> RedactOutcome {
    run(&compile_rules(rules), text)
}

fn run(set: &RuleSet, text: &str) -> RedactOutcome {
    if text.is_empty() {
        return RedactOutcome {
            text: text.to_string(),
            hits: Vec::new(),
            count: 0,
        };
    }

    let mut current = text.to_string();
    let mut hits = Vec::new();
    let mut count = 0usize;

    for spec in &set.specs {
        let produced;
        match spec {
            RuleSpec::Builtin {
                rule,
                enabled: true,
            } => {
                produced = apply_builtin(*rule, &current);
            }
            RuleSpec::Builtin { enabled: false, .. } => continue,
            RuleSpec::Custom(compiled) => {
                if let Some((out, replaced)) = apply_custom(compiled, &current) {
                    if replaced > 0 {
                        current = out;
                        hits.push(compiled.name.clone());
                        count += replaced;
                    }
                }
                continue;
            }
        }
        // produced == (Some(text, replaced)) when the rule replaced something.
        if let Some((out, replaced)) = produced {
            current = out;
            if replaced > 0 {
                match spec {
                    RuleSpec::Builtin { rule, .. } => {
                        hits.push(rule.display_name().to_string());
                    }
                    RuleSpec::Custom(_) => unreachable!("custom handled above"),
                }
                count += replaced;
            }
        }
    }

    RedactOutcome {
        text: current,
        hits,
        count,
    }
}

/// Apply a built-in's own fixed masking to `text`, returning the new text and
/// how many spans it replaced. Returns `None` when nothing matched.
fn apply_builtin(builtin: BuiltinRule, text: &str) -> Option<(String, usize)> {
    match builtin {
        BuiltinRule::Arn => mask_pattern_all(text, arn_re(), "[ARN]"),
        BuiltinRule::S3Bucket => mask_pattern_all(text, s3_bucket_re(), "s3://[S3_BUCKET]/"),
        BuiltinRule::AccountId => Some(redact_account_ids(text)),
        BuiltinRule::Ipv4 => mask_pattern_all(text, ip_address_re(), "[IP_ADDRESS]"),
        BuiltinRule::Ec2Hostname => mask_pattern_all(text, ec2_hostname_re(), "[HOSTNAME]"),
        BuiltinRule::Fqdn => mask_pattern_all(text, fqdn_re(), "[HOSTNAME]"),
    }
    .filter(|(_, replaced)| *replaced > 0)
}

/// Replace every non-overlapping match of `pattern` with the fixed `token`,
/// reporting how many were replaced — byte-identical to
/// `pattern.replace_all(text, token)` at a span level.
fn mask_pattern_all(text: &str, pattern: &Regex, token: &str) -> Option<(String, usize)> {
    let mut out = String::with_capacity(text.len());
    let mut last = 0usize;
    let mut replaced = 0usize;
    for m in pattern.find_iter(text) {
        out.push_str(&text[last..m.start()]);
        out.push_str(token);
        last = m.end();
        replaced += 1;
    }
    if replaced == 0 {
        return None;
    }
    out.push_str(&text[last..]);
    Some((out, replaced))
}

/// Redact standalone 12-digit AWS account IDs. The TS version used a lookbehind
/// (`(?<!\d)`); Rust's regex crate has none, so scan matches and check the
/// neighbouring bytes by hand — a match inside a larger number is left alone.
fn redact_account_ids(text: &str) -> (String, usize) {
    let mut out = String::with_capacity(text.len());
    let mut last = 0usize;
    let mut replaced = 0usize;
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
            replaced += 1;
        }
        last = end;
    }
    out.push_str(&text[last..]);
    (out, replaced)
}

/// Apply one custom rule: anywhere the `regex` matches, the matched token is
/// replaced by the rule's mask macro / literal. Returns `None` when the pattern
/// is invalid (treated as a no-op) or there was nothing to replace.
fn apply_custom(compiled: &CompiledCustom, text: &str) -> Option<(String, usize)> {
    let pattern = compiled.regex.as_ref()?;
    let mut out = String::with_capacity(text.len());
    let mut last = 0usize;
    let mut replaced = 0usize;
    for m in pattern.find_iter(text) {
        let start = m.start();
        let end = m.end();
        out.push_str(&text[last..start]);
        out.push_str(&apply_replacement(&text[start..end], &compiled.replacement));
        last = end;
        replaced += 1;
    }
    if replaced == 0 {
        return None;
    }
    out.push_str(&text[last..]);
    Some((out, replaced))
}

/// The reference "Shield" mask macro semantics, ported from `applyReplacement`
/// (ai-desensitizer web UI). Called with the whole matched token.
fn apply_replacement(matched: &str, replacement: &str) -> String {
    let repl = if replacement.is_empty() {
        "***"
    } else {
        replacement
    };

    if repl == "__MASK_ALL__" {
        let len = matched.chars().count();
        return if len == 0 {
            "*".repeat(3)
        } else {
            "*".repeat(len)
        };
    }

    if let Some(spec) = parse_keep_head_tail(repl) {
        return keep_head_tail(matched, spec);
    }

    // A plain literal replacement (the common case for ticket ids, emails,
    // phone numbers). Backslash/`$` capture notation is intentionally not
    // expanded — custom patterns mask a whole token, matching the reference.
    repl.to_string()
}

/// `("a","b")` when `repl` looks like `__KEEP_HEAD_TAIL_<a>_<b>__`.
fn parse_keep_head_tail(repl: &str) -> Option<(usize, usize)> {
    // Everything between the opening header and the closing `__` is `<a>_<b>`.
    let body = repl.strip_prefix("__KEEP_HEAD_TAIL_")?.strip_suffix("__")?;
    let (a, b) = body.split_once('_')?;
    Some((a.parse().ok()?, b.parse().ok()?))
}

fn keep_head_tail(matched: &str, (a, b): (usize, usize)) -> String {
    let len = matched.chars().count();
    if len <= a + b {
        return "*".repeat(len);
    }
    let head: String = matched.chars().take(a).collect();
    let tail: String = matched.chars().skip(len - b).collect();
    let stars = "*".repeat(len - a - b);
    format!("{head}{stars}{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rule set is process-global (`CURRENT_RULES`), so a test that installs
    /// its own and a test that asserts the defaults must not run at the same
    /// time — `load_rules_controls_what_sanitize_applies` disables FQDN for the
    /// length of its body. Any test asserting what a *default* rule redacts
    /// takes this first. Poisoning is ignored: one failing test should not take
    /// its neighbours down with it.
    fn rules_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    // Default rules (all six built-ids on) must reproduce the original fixed
    // behaviour byte-for-byte.

    #[test]
    fn redacts_the_builtin_account_ids() {
        let text = "Running on account 123456789012 with bucket my-bucket";
        let result = sanitize(text);
        assert!(result.contains("[AWS_ACCOUNT_ID]"));
        assert!(!result.contains("123456789012"));
    }

    #[test]
    fn redacts_the_builtin_s3_bucket_names() {
        let text = "Uploading to s3://my-data-lake-us-east-1/jobs/abc123/";
        let result = sanitize(text);
        assert!(result.contains("s3://[S3_BUCKET]/"));
        assert!(!result.contains("my-data-lake-us-east-1"));
    }

    #[test]
    fn redacts_the_builtin_arns() {
        let text = "Assuming role arn:aws:iam::123456789012:role/EMR_ExecutionRole";
        let result = sanitize(text);
        assert!(result.contains("[ARN]"));
        assert!(!result.contains("123456789012"));
        assert!(!result.contains("EMR_ExecutionRole"));
    }

    #[test]
    fn redacts_the_builtin_ip_addresses() {
        let text = "Connecting to 10.0.1.45:8080 and 192.168.1.1:5432";
        let result = sanitize(text);
        assert!(result.contains("[IP_ADDRESS]"));
        assert!(!result.contains("10.0.1.45"));
        assert!(!result.contains("192.168.1.1"));
    }

    #[test]
    fn redacts_the_builtin_ec2_hostnames() {
        let text = "Connecting to ip-10-0-1-45.ec2.internal:8080";
        let result = sanitize(text);
        assert!(result.contains("[HOSTNAME]"));
        assert!(!result.contains("ip-10-0-1-45.ec2.internal"));
    }

    #[test]
    fn redacts_the_builtin_fqdn_hostnames() {
        let _guard = rules_lock();
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

    // --- Config-driven behaviour -------------------------------------------

    fn custom(id: &str, name: &str, pattern: &str, replacement: &str, sort: i64) -> RedactRule {
        RedactRule {
            id: id.to_string(),
            name: name.to_string(),
            category: "custom".to_string(),
            pattern: Some(pattern.to_string()),
            replacement: Some(replacement.to_string()),
            sample: None,
            enabled: true,
            kind: RedactRuleKind::Custom,
            sort_order: sort,
        }
    }

    /// A default-enabled built-in model from the seed, optionally overridden.
    fn builtin(slug: &str, enabled: bool) -> RedactRule {
        let mut rule = default_rule_models()
            .into_iter()
            .find(|raw| raw.id == slug)
            .expect("builtin");
        rule.enabled = enabled;
        rule
    }

    #[test]
    fn disabling_a_builtin_stops_only_that_builtin() {
        // Turn the S3 rule off: a bucket must survive while every sibling still
        // redacts.
        let rules = vec![
            builtin("arn", true),
            builtin("s3-bucket", false),
            builtin("account-id", true),
            builtin("ipv4", true),
            builtin("ec2-host", true),
            builtin("fqdn", true),
        ];
        let out = sanitize_with_rules(
            "role arn:aws:iam::123456789012:role/R via s3://etl-prod-bucket/jobs/ and 10.0.0.1",
            &rules,
        );
        assert!(
            out.text.contains("etl-prod-bucket"),
            "s3 disabled keeps bucket, got: {}",
            out.text
        );
        assert!(
            out.text.contains("[IP_ADDRESS]"),
            "ipv4 still masks, got: {}",
            out.text
        );
        assert!(!out.hits.contains(&"S3 bucket (keeps s3://)".to_string()));
    }

    #[test]
    fn disabling_fqdn_lets_hostnames_through() {
        let rules = vec![
            builtin("arn", true),
            builtin("s3-bucket", true),
            builtin("account-id", true),
            builtin("ipv4", false),
            builtin("ec2-host", true),
            builtin("fqdn", false),
        ];
        let host = "my-cluster.us-east-1.elb.amazonaws.com";
        let out = sanitize_with_rules(&format!("Connecting to {host}:8080"), &rules);
        // No raw IPv4; the alphanumeric host should no longer be masked by fqdn.
        assert!(out.text.contains(host), "got: {}", out.text);
        assert!(!out.hits.contains(&"FQDN hostname".to_string()));
    }

    #[test]
    fn enabled_custom_rule_masks_all_occurrences() {
        let rule = custom("t1", "Ticket", r"TICKET-\d+", "__MASK_ALL__", 0);
        let out = sanitize_with_rules("ref TICKET-123456 and TICKET-78 done", &[rule]);
        // Each token becomes an equal-length run of stars.
        assert_eq!(out.text, "ref ************* and ********* done");
        assert_eq!(out.hits, vec!["Ticket".to_string()]);
        assert_eq!(out.count, 2);
    }

    #[test]
    fn keep_head_tail_custom_replacement() {
        let rule = custom(
            "card",
            "Card tail",
            r"\b\d{16}\b",
            "__KEEP_HEAD_TAIL_4_4__",
            0,
        );
        let out = sanitize_with_rules("card 1234567812345678 end", &[rule]);
        assert_eq!(out.text, "card 1234********5678 end");
    }

    #[test]
    fn literal_custom_replacement() {
        // A whole-token match is replaced by the literal verbatim.
        let rule = custom("tok", "Order id", r"\bID-\d{4}\b", "[ORDER_ID]", 0);
        let out = sanitize_with_rules("row ID-1234 and ID-9876", &[rule]);
        assert_eq!(out.text, "row [ORDER_ID] and [ORDER_ID]");
        assert_eq!(out.count, 2);
    }

    #[test]
    fn invalid_custom_regex_is_skipped_not_a_crash() {
        let rule = custom("bad", "Bad", r"[unterminated", "__MASK_ALL__", 0);
        let out = sanitize_with_rules("anything at all", &[rule]);
        assert_eq!(out.text, "anything at all");
        assert!(out.hits.is_empty());
    }

    #[test]
    fn load_rules_controls_what_sanitize_applies() {
        let _guard = rules_lock();
        // Starting state: all defaults.
        assert!(sanitize("my-cluster.us-east-1.elb.amazonaws.com").contains("[HOSTNAME]"));

        // After loading a config that disables FQDN, `sanitize` no longer masks hostnames.
        let mut rules = default_rule_models();
        for rule in &mut rules {
            if rule.id == "fqdn" {
                rule.enabled = false;
            }
        }
        load_rules(&rules);
        assert!(sanitize("a.b.c.example.com").contains("example.com"));
        // Sibling built-ins still run while FQDN is off.
        assert!(sanitize("arn:aws:iam::123456789012:role/R").contains("[ARN]"));

        // And back to defaults.
        reset_rules();
        assert!(sanitize("my-cluster.us-east-1.elb.amazonaws.com").contains("[HOSTNAME]"));
    }
}
