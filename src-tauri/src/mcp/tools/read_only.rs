//! The read-only tools beyond `analyze_job_failure`.
//!
//! In-process calls are nearly free, so the Chat model (and any external agent)
//! can drill down itself — list the log objects, then read the one that looks
//! relevant — instead of forcing every question through the one-shot analysis
//! tool. Everything here is read-only: no `StartJobRun`, no `CancelJobRun`, no
//! S3 writes.

use serde::Serialize;

use crate::error::AppResult;
use crate::mcp::sanitize;
use crate::mcp::tools::analyze_job_failure::{JobDataSource, LogObject};

/// Account shape exposed to the LLM.
///
/// Deliberately omits access keys, the AWS account number, and the full identity
/// ARN — only a human-readable username is exposed so the model can tell
/// accounts apart. This is the same projection the old bridge's `BridgeAccount`
/// enforced, and it is the one place where account data crosses to the model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SafeAccount {
    pub id: String,
    pub name: String,
    pub region: String,
    pub is_active: bool,
    /// Trailing segment of the identity ARN (an IAM user or role name), falling
    /// back to the account's display name. Never the ARN itself.
    pub username: String,
}

impl From<crate::models::AwsAccount> for SafeAccount {
    fn from(account: crate::models::AwsAccount) -> Self {
        let username = account
            .identity
            .as_ref()
            .and_then(|identity| identity.arn.rsplit('/').next())
            .filter(|segment| !segment.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| account.name.clone());

        Self {
            id: account.id,
            name: account.name,
            region: account.region,
            is_active: account.is_active,
            username,
        }
    }
}

pub async fn list_accounts() -> AppResult<Vec<SafeAccount>> {
    let pool = crate::db::repository::pool().await?;
    Ok(crate::db::repository::list_aws_accounts(&pool)
        .await?
        .into_iter()
        .map(SafeAccount::from)
        .collect())
}

// --- find_job -------------------------------------------------------------

#[derive(Debug, Clone, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FindJobArgs {
    /// Complete EMR job run ID. Never truncate or invent it.
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FindJobResult {
    pub id: String,
    pub name: Option<String>,
    pub state: String,
    pub virtual_cluster_id: String,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub failure_reason: Option<String>,
    pub state_details: Option<String>,
    pub release_label: Option<String>,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub region: Option<String>,
    /// True when the job lives in an account that is not the app's active one.
    pub found_in_other_account: bool,
    /// Where the job's logs live, when the job declares a monitoring config.
    pub log_destinations: LogDestinationsResult,
    /// Populated when the job could not be located.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LogDestinationsResult {
    pub s3_bucket: Option<String>,
    pub s3_prefix: Option<String>,
    pub cloud_watch_log_group: Option<String>,
    pub cloud_watch_stream_prefix: Option<String>,
}

impl FindJobResult {
    /// An error projection, so the tool never has to fail hard on the wire —
    /// the calling model gets a structured "not found" instead of a transport
    /// error, and the audit row records what happened.
    pub fn not_found(message: &str) -> Self {
        Self {
            id: String::new(),
            name: None,
            state: String::new(),
            virtual_cluster_id: String::new(),
            created_at: None,
            started_at: None,
            finished_at: None,
            failure_reason: None,
            state_details: None,
            release_label: None,
            account_id: None,
            account_name: None,
            region: None,
            found_in_other_account: false,
            log_destinations: LogDestinationsResult::default(),
            error: Some(message.to_string()),
        }
    }
}

pub async fn find_job<S: JobDataSource>(
    source: &S,
    args: &FindJobArgs,
) -> AppResult<FindJobResult> {
    use crate::mcp::job_id;

    if !job_id::is_likely_emr_job_run_id(&args.job_id) {
        return Err(crate::error::AppError::validation(
            job_id::describe_invalid_job_id(&args.job_id),
        ));
    }
    let normalized = job_id::normalize(&args.job_id);
    let found = source.find_job(&normalized).await?;
    let job = found.job;

    let destinations = crate::mcp::log_destinations::resolve(
        &job.id,
        &job.virtual_cluster_id,
        job.configuration_overrides.as_ref(),
    );

    Ok(FindJobResult {
        id: job.id,
        name: job.name,
        state: job.state,
        virtual_cluster_id: job.virtual_cluster_id,
        created_at: job.created_at,
        started_at: job.started_at,
        finished_at: job.finished_at,
        // Failure text can quote log content, so it is sanitized like any log.
        failure_reason: job.failure_reason.as_deref().map(sanitize::sanitize),
        state_details: job.state_details.as_deref().map(sanitize::sanitize),
        release_label: job.release_label,
        account_id: found.account_id,
        account_name: found.account_name,
        region: found.region,
        found_in_other_account: found.found_in_other_account,
        log_destinations: LogDestinationsResult {
            s3_bucket: destinations.s3.as_ref().map(|d| d.bucket.clone()),
            s3_prefix: destinations.s3.as_ref().map(|d| d.prefix.clone()),
            cloud_watch_log_group: destinations
                .cloud_watch
                .as_ref()
                .map(|d| d.log_group_name.clone()),
            cloud_watch_stream_prefix: destinations
                .cloud_watch
                .as_ref()
                .and_then(|d| d.stream_name_prefix.clone()),
        },
        error: None,
    })
}

// --- list_job_log_objects -------------------------------------------------

#[derive(Debug, Clone, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListJobLogObjectsArgs {
    /// Complete EMR job run ID.
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobLogObject {
    /// S3 key, to pass back to `get_job_log_text`.
    pub s3_key: String,
    /// "controller" | "driver" | "executor", or "sparkLog" when unclassified.
    pub log_type: String,
}

#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListJobLogObjectsResult {
    pub job_id: String,
    pub bucket: Option<String>,
    pub objects: Vec<JobLogObject>,
    /// Set when the job has no S3 log archive — read CloudWatch instead, using
    /// the log group from `find_job`.
    pub note: Option<String>,
}

pub async fn list_job_log_objects<S: JobDataSource>(
    source: &S,
    args: &ListJobLogObjectsArgs,
) -> AppResult<ListJobLogObjectsResult> {
    let found = find_job(
        source,
        &FindJobArgs {
            job_id: args.job_id.clone(),
        },
    )
    .await?;

    let (Some(bucket), Some(prefix)) = (
        found.log_destinations.s3_bucket.clone(),
        found.log_destinations.s3_prefix.clone(),
    ) else {
        return Ok(ListJobLogObjectsResult {
            job_id: found.id,
            bucket: None,
            objects: Vec::new(),
            note: Some(
                "This job has no S3 log archive. Use analyze_job_failure, which also reads CloudWatch."
                    .to_string(),
            ),
        });
    };

    let objects = source
        .list_s3_objects(found.account_id.as_deref(), &bucket, &prefix)
        .await?;

    Ok(ListJobLogObjectsResult {
        job_id: found.id,
        bucket: Some(bucket),
        objects: objects
            .into_iter()
            .map(|object: LogObject| JobLogObject {
                s3_key: object.s3_key,
                log_type: object.log_type,
            })
            .collect(),
        note: None,
    })
}

// --- get_job_log_text -----------------------------------------------------

/// Cap on lines returned in one read, so a multi-hundred-megabyte driver log
/// cannot blow up the model's context.
const DEFAULT_LOG_TAIL_LINES: usize = 500;
const MAX_LOG_TAIL_LINES: usize = 2000;

#[derive(Debug, Clone, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetJobLogTextArgs {
    /// Complete EMR job run ID (used to locate the account).
    pub job_id: String,
    /// S3 key from `list_job_log_objects`.
    pub s3_key: String,
    /// How many trailing lines to return (default 500, max 2000).
    #[serde(default)]
    pub tail_lines: Option<usize>,
    /// When true, keep routine INFO chatter instead of filtering it out.
    #[serde(default)]
    pub include_noise: Option<bool>,
}

#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetJobLogTextResult {
    pub s3_key: String,
    /// Sanitized log text — the trailing `tailLines` lines.
    pub text: String,
    pub returned_lines: usize,
    pub total_lines: usize,
    pub noise_filtered_lines: usize,
    pub truncated: bool,
    /// Populated when the object could not be read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn get_job_log_text<S: JobDataSource>(
    source: &S,
    args: &GetJobLogTextArgs,
) -> AppResult<GetJobLogTextResult> {
    let found = find_job(
        source,
        &FindJobArgs {
            job_id: args.job_id.clone(),
        },
    )
    .await?;
    let bucket = found.log_destinations.s3_bucket.clone().ok_or_else(|| {
        crate::error::AppError::validation(
            "This job has no S3 log archive; there is no object to read.",
        )
    })?;

    // Only keys under the job's own log prefix are readable, so a caller cannot
    // turn this tool into an arbitrary S3 reader.
    let prefix = found.log_destinations.s3_prefix.clone().unwrap_or_default();
    if !prefix.is_empty() && !args.s3_key.starts_with(&prefix) {
        return Err(crate::error::AppError::validation(format!(
            "The key {} is outside this job's log prefix. Call list_job_log_objects first and pass one of the keys it returns.",
            args.s3_key
        )));
    }

    let raw = source
        .get_s3_object(found.account_id.as_deref(), &bucket, &args.s3_key)
        .await?;

    let total_lines = raw.split('\n').count();
    let (text, noise_filtered_lines) = if args.include_noise.unwrap_or(false) {
        (raw, 0)
    } else {
        let filtered = crate::mcp::noise::filter(&raw);
        (filtered.text, filtered.hidden_count)
    };

    let lines: Vec<&str> = text
        .split('\n')
        .filter(|line| !line.trim().is_empty())
        .collect();
    let tail = args
        .tail_lines
        .unwrap_or(DEFAULT_LOG_TAIL_LINES)
        .min(MAX_LOG_TAIL_LINES);
    let start = lines.len().saturating_sub(tail);
    let returned = &lines[start..];

    Ok(GetJobLogTextResult {
        s3_key: args.s3_key.clone(),
        text: sanitize::sanitize(&returned.join("\n")),
        returned_lines: returned.len(),
        total_lines,
        noise_filtered_lines,
        truncated: start > 0,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AwsAccount, AwsIdentity};
    use chrono::Utc;

    fn account(name: &str, arn: Option<&str>) -> AwsAccount {
        AwsAccount {
            id: "acct-1".to_string(),
            name: name.to_string(),
            region: "us-east-1".to_string(),
            access_key_id_masked: "AKIA****WXYZ".to_string(),
            identity: arn.map(|arn| AwsIdentity {
                account: "123456789012".to_string(),
                arn: arn.to_string(),
                user_id: "AIDAEXAMPLE".to_string(),
            }),
            is_active: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    /// The LLM-facing projection must never carry credential material, the AWS
    /// account number, or the full ARN — only a human-readable username.
    #[test]
    fn safe_account_exposes_only_a_username() {
        let safe = SafeAccount::from(account(
            "Prod",
            Some("arn:aws:iam::123456789012:user/data-eng"),
        ));

        assert_eq!(safe.username, "data-eng");
        let json = serde_json::to_string(&safe).expect("serializes");
        assert!(!json.contains("123456789012"), "no account number: {json}");
        assert!(!json.contains("arn:aws"), "no ARN: {json}");
        assert!(!json.contains("AKIA"), "no access key: {json}");
        assert!(!json.contains("accessKeyIdMasked"), "no key field: {json}");
    }

    #[test]
    fn safe_account_falls_back_to_the_display_name() {
        // No identity at all (credentials never validated).
        assert_eq!(
            SafeAccount::from(account("Staging", None)).username,
            "Staging"
        );
        // An ARN with no trailing segment.
        assert_eq!(
            SafeAccount::from(account("Staging", Some("arn:aws:iam::123456789012:root"))).username,
            "arn:aws:iam::123456789012:root",
        );
    }

    /// Assumed-role ARNs end in the session name, which is the most useful
    /// human-readable label available.
    #[test]
    fn safe_account_uses_the_session_name_for_assumed_roles() {
        let safe = SafeAccount::from(account(
            "Prod",
            Some("arn:aws:sts::123456789012:assumed-role/EMRAdmin/jinghui"),
        ));
        assert_eq!(safe.username, "jinghui");
    }
}
