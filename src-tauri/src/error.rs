use aws_smithy_types::error::metadata::ProvideErrorMetadata;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Structured context for a failed provider request, kept so the Chat transcript
/// can show *why* a call failed — the URL, HTTP status, response body, and so on —
/// instead of a bare sentence.
///
/// `request_body` holds what the app sent (it never contains the API key, which
/// travels in a header), and `response_body` holds what the provider returned.
/// Both are capped to a few KB when captured so a large log-ish body cannot bloat
/// the stored row.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// HTTP method, e.g. "POST".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_body: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_body: Option<String>,
    /// The provider's own reported reason, when it gives one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    /// "http" | "stream" | "transport" | "resolve"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
    /// The innermost cause for transport/resolve failures.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

#[derive(Debug, Clone, Error, Serialize)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub kind: Box<str>,
    pub code: Box<str>,
    pub message: Box<str>,
    pub service: Option<Box<str>>,
    pub request_id: Option<Box<str>>,
    pub retryable: bool,
    pub account_id: Option<Box<str>>,
    /// Optional structured diagnostics (e.g. a failed LLM request). AWS and other
    /// callers leave it `None`, so it never changes their payloads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<ErrorDetails>,
}

impl AppError {
    pub fn aws(service: &'static str, error: impl std::fmt::Display) -> Self {
        Self {
            kind: "aws".into(),
            service: Some(service.into()),
            code: "AwsSdkError".into(),
            message: error.to_string().into(),
            request_id: None,
            retryable: false,
            account_id: None,
            details: None,
        }
    }

    pub fn aws_for_account(
        service: &'static str,
        account_id: impl Into<String>,
        error: impl std::fmt::Display,
    ) -> Self {
        Self {
            account_id: Some(account_id.into().into()),
            ..Self::aws(service, error)
        }
    }

    pub fn aws_sdk(
        service: &'static str,
        error: impl ProvideErrorMetadata + std::fmt::Display,
    ) -> Self {
        Self::from_aws_metadata(service, None, &error)
    }

    pub fn aws_for_account_sdk(
        service: &'static str,
        account_id: impl Into<String>,
        error: impl ProvideErrorMetadata + std::fmt::Display,
    ) -> Self {
        Self::from_aws_metadata(service, Some(account_id.into()), &error)
    }

    fn from_aws_metadata(
        service: &'static str,
        account_id: Option<String>,
        error: &(impl ProvideErrorMetadata + std::fmt::Display),
    ) -> Self {
        let code: Box<str> = error
            .code()
            .filter(|value| !value.is_empty())
            .unwrap_or("AwsSdkError")
            .into();
        let message: Box<str> = humanize_aws_error(service, error).into();
        let request_id = error
            .meta()
            .extra("aws_request_id")
            .or_else(|| error.meta().extra("request_id"))
            .map(str::to_string)
            .map(Into::into);

        let retryable = is_retryable_aws_code(&code)
            || message.to_ascii_lowercase().contains("too many requests");

        Self {
            kind: "aws".into(),
            service: Some(service.into()),
            code,
            message,
            request_id,
            retryable,
            account_id: account_id.map(Into::into),
            details: None,
        }
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self {
            kind: "storage".into(),
            code: "StorageError".into(),
            message: message.into().into(),
            service: None,
            request_id: None,
            retryable: false,
            account_id: None,
            details: None,
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            kind: "validation".into(),
            code: "ValidationError".into(),
            message: message.into().into(),
            service: None,
            request_id: None,
            retryable: false,
            account_id: None,
            details: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: "internal".into(),
            code: "InternalError".into(),
            message: message.into().into(),
            service: None,
            request_id: None,
            retryable: false,
            account_id: None,
            details: None,
        }
    }
}

impl AppError {
    /// Attaches structured diagnostics, e.g. the failed request for an LLM call.
    pub fn with_details(mut self, details: ErrorDetails) -> Self {
        self.details = Some(details);
        self
    }
}

/// Keeps a captured body bounded: `None` for empty input, truncated past `cap`
/// with a marker so the transcript does not say something ended that did not.
pub fn capped(text: &str, cap: usize) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.chars().count() <= cap {
        return Some(trimmed.to_string());
    }
    let mut truncated: String = trimmed.chars().take(cap).collect();
    truncated.push_str("… [truncated]");
    Some(truncated)
}

/// The chain of `source()` causes for an error, joined by " → ". For a reqwest
/// failure this reaches the DNS/TLS/refused-connection root the wrapper restates.
pub fn source_chain(error: &dyn std::error::Error) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current: Option<&dyn std::error::Error> = Some(error);
    while let Some(cause) = current {
        parts.push(cause.to_string());
        current = cause.source();
    }
    parts.join(" → ")
}

fn humanize_aws_error(
    service: &str,
    error: &(impl ProvideErrorMetadata + std::fmt::Display),
) -> String {
    if let Some(message) = error.message().filter(|message| !message.is_empty()) {
        if service == "athena" && message.contains("Queries of this type are not supported") {
            return format!(
                "{message} Hint: Use Hive/Spark SQL syntax (CREATE EXTERNAL TABLE, LOCATION, PARTITIONED BY, backtick identifiers)."
            );
        }
        return message.to_string();
    }

    if let Some(code) = error.code() {
        if let Some(message) = message_for_aws_code(service, code) {
            return message;
        }
        return format!("AWS {service} error ({code}).");
    }

    match error.to_string().as_str() {
        "service error" => format!(
            "AWS {service} request failed. Check account permissions and region in Settings."
        ),
        "request has timed out" => format!("AWS {service} request timed out. Try again."),
        "dispatch failure" => {
            format!("Could not connect to AWS {service}. Check network connectivity.")
        }
        "failed to construct request" => format!("Failed to prepare AWS {service} request."),
        "response error" => format!("Received an invalid response from AWS {service}."),
        display => format!("{display} ({service})"),
    }
}

fn is_retryable_aws_code(code: &str) -> bool {
    matches!(
        code,
        "Throttling"
            | "ThrottlingException"
            | "TooManyRequestsException"
            | "RequestLimitExceeded"
            | "SlowDown"
            | "ProvisionedThroughputExceededException"
    )
}

fn message_for_aws_code(service: &str, code: &str) -> Option<String> {
    match code {
        "AccessDenied" | "AccessDeniedException" => Some(access_denied_message(service)),
        "InvalidAccessKeyId" => Some(
            "Invalid AWS Access Key ID. Verify the credentials saved for this account in Settings."
                .to_string(),
        ),
        "SignatureDoesNotMatch" => Some(
            "AWS secret access key does not match the access key ID. Update the account credentials in Settings."
                .to_string(),
        ),
        "ExpiredToken" | "InvalidToken" | "TokenRefreshRequired" => Some(
            "AWS session token has expired. Update the temporary credentials for this account in Settings."
                .to_string(),
        ),
        "NoSuchBucket" => Some(
            "The S3 bucket does not exist or is not accessible in the configured region.".to_string(),
        ),
        "NoSuchKey" => Some("The S3 object does not exist.".to_string()),
        "PermanentRedirect" => Some(
            "S3 bucket is in a different AWS region than the active account. Reopen the bucket after listing buckets or update the account region in Settings.".to_string(),
        ),
        "UnauthorizedOperation" => Some(
            "This AWS account is not authorized for this operation. Check IAM permissions in Settings."
                .to_string(),
        ),
        "InvalidRequestException" if service == "athena" => Some(
            "Athena rejected this query. Check Hive/Spark SQL syntax, workgroup type (SQL vs Spark), and result output settings."
                .to_string(),
        ),
        "MALFORMED_QUERY" => Some(
            "Athena could not parse this SQL. Use Hive/Spark SQL for DDL (CREATE EXTERNAL TABLE, LOCATION, PARTITIONED BY)."
                .to_string(),
        ),
        _ => None,
    }
}

fn access_denied_message(service: &str) -> String {
    match service {
        "s3" => "Access denied for S3. Grant permissions such as s3:ListAllMyBuckets, s3:ListBucket, s3:GetObject, and s3:PutObject to this account in IAM, then verify the region in Settings.".to_string(),
        "emr-containers" => "Access denied for EMR on EKS. Check IAM permissions for emr-containers actions on this account.".to_string(),
        "cloudwatchlogs" => "Access denied for CloudWatch Logs. Check IAM permissions for logs:FilterLogEvents and related actions.".to_string(),
        "sts" => "Access denied when validating AWS credentials. Ensure sts:GetCallerIdentity is allowed for this account.".to_string(),
        _ => format!("Access denied for AWS {service}. Check IAM permissions for this account in Settings."),
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::internal(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::AppError;
    use aws_smithy_types::error::ErrorMetadata;

    #[test]
    fn validation_error_serializes_as_stable_dto() {
        let error = AppError::validation("Account is required.");
        let value = serde_json::to_value(error).expect("error serializes");

        assert_eq!(value["kind"], "validation");
        assert_eq!(value["code"], "ValidationError");
        assert_eq!(value["message"], "Account is required.");
    }

    #[test]
    fn aws_error_uses_service_metadata_instead_of_generic_display() {
        let metadata = ErrorMetadata::builder()
            .code("AccessDenied")
            .message("User is not authorized to perform: s3:ListAllMyBuckets")
            .build();
        let error = AppError::aws_sdk("s3", metadata);

        assert_eq!(error.code.as_ref(), "AccessDenied");
        assert_eq!(
            error.message.as_ref(),
            "User is not authorized to perform: s3:ListAllMyBuckets"
        );
    }

    #[test]
    fn aws_error_falls_back_to_permission_guidance_for_access_denied_without_message() {
        let metadata = ErrorMetadata::builder().code("AccessDenied").build();
        let error = AppError::aws_sdk("s3", metadata);

        assert_eq!(error.code.as_ref(), "AccessDenied");
        assert!(error.message.contains("Access denied for S3"));
    }

    #[test]
    fn aws_throttle_errors_are_marked_retryable() {
        let metadata = ErrorMetadata::builder()
            .code("ThrottlingException")
            .message("Too Many Requests")
            .build();
        let error = AppError::aws_sdk("emr-containers", metadata);

        assert_eq!(error.code.as_ref(), "ThrottlingException");
        assert!(error.retryable);
        assert_eq!(error.message.as_ref(), "Too Many Requests");
    }

    #[test]
    fn aws_too_many_requests_message_is_retryable_without_known_code() {
        let metadata = ErrorMetadata::builder()
            .message("Too Many Requests")
            .build();
        let error = AppError::aws_sdk("emr-containers", metadata);

        assert!(error.retryable);
    }
}
