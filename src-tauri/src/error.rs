use aws_smithy_types::error::metadata::ProvideErrorMetadata;
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Error, Serialize)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub kind: String,
    pub code: String,
    pub message: String,
    pub service: Option<String>,
    pub request_id: Option<String>,
    pub retryable: bool,
    pub account_id: Option<String>,
}

impl AppError {
    pub fn aws(service: &'static str, error: impl std::fmt::Display) -> Self {
        Self {
            kind: "aws".to_string(),
            service: Some(service.to_string()),
            code: "AwsSdkError".to_string(),
            message: error.to_string(),
            request_id: None,
            retryable: false,
            account_id: None,
        }
    }

    pub fn aws_for_account(
        service: &'static str,
        account_id: impl Into<String>,
        error: impl std::fmt::Display,
    ) -> Self {
        Self {
            account_id: Some(account_id.into()),
            ..Self::aws(service, error)
        }
    }

    pub fn aws_sdk(service: &'static str, error: impl ProvideErrorMetadata + std::fmt::Display) -> Self {
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
        let code = error
            .code()
            .filter(|value| !value.is_empty())
            .unwrap_or("AwsSdkError")
            .to_string();
        let message = humanize_aws_error(service, error);
        let request_id = error
            .meta()
            .extra("aws_request_id")
            .or_else(|| error.meta().extra("request_id"))
            .map(str::to_string);

        Self {
            kind: "aws".to_string(),
            service: Some(service.to_string()),
            code,
            message,
            request_id,
            retryable: false,
            account_id,
        }
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self {
            kind: "storage".to_string(),
            code: "StorageError".to_string(),
            message: message.into(),
            service: None,
            request_id: None,
            retryable: false,
            account_id: None,
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            kind: "validation".to_string(),
            code: "ValidationError".to_string(),
            message: message.into(),
            service: None,
            request_id: None,
            retryable: false,
            account_id: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: "internal".to_string(),
            code: "InternalError".to_string(),
            message: message.into(),
            service: None,
            request_id: None,
            retryable: false,
            account_id: None,
        }
    }
}

fn humanize_aws_error(service: &str, error: &(impl ProvideErrorMetadata + std::fmt::Display)) -> String {
    if let Some(message) = error.message().filter(|message| !message.is_empty()) {
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

        assert_eq!(error.code, "AccessDenied");
        assert_eq!(
            error.message,
            "User is not authorized to perform: s3:ListAllMyBuckets"
        );
    }

    #[test]
    fn aws_error_falls_back_to_permission_guidance_for_access_denied_without_message() {
        let metadata = ErrorMetadata::builder().code("AccessDenied").build();
        let error = AppError::aws_sdk("s3", metadata);

        assert_eq!(error.code, "AccessDenied");
        assert!(error.message.contains("Access denied for S3"));
    }
}
