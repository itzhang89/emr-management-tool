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

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn validation_error_serializes_as_stable_dto() {
        let error = AppError::validation("Account is required.");
        let value = serde_json::to_value(error).expect("error serializes");

        assert_eq!(value["kind"], "validation");
        assert_eq!(value["code"], "ValidationError");
        assert_eq!(value["message"], "Account is required.");
    }
}
