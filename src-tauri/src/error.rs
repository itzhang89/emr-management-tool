use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppError {
    #[error("{message}")]
    Aws {
        service: &'static str,
        code: String,
        message: String,
    },
    #[error("{0}")]
    Storage(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn aws(service: &'static str, error: impl std::fmt::Display) -> Self {
        Self::Aws {
            service,
            code: "AwsSdkError".to_string(),
            message: error.to_string(),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
