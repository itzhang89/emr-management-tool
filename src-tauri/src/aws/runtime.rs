use crate::aws::auth::resolve_aws_auth;
use crate::db::repository;
use crate::diagnostics;
use crate::error::{AppError, AppResult};
use crate::models::{AwsAccount, AwsAuthMethod, AwsCommandContext};
use tauri::AppHandle;

pub struct AwsRuntime {
    pub account: AwsAccount,
    pub config: aws_config::SdkConfig,
    /// e.g. `mfaSession:ASIA…` — attached to AWS failures for debugging auth path.
    pub auth_fingerprint: String,
}

pub async fn runtime_for_context(
    app: &AppHandle,
    context: AwsCommandContext,
) -> AppResult<AwsRuntime> {
    let pool = repository::pool().await?;
    let account = match context.account_id {
        Some(account_id) => repository::get_aws_account(&pool, &account_id)
            .await?
            .ok_or_else(|| {
                AppError::validation(format!("AWS account {account_id} was not found."))
            })?,
        None => repository::active_aws_account(&pool)
            .await?
            .ok_or_else(|| AppError::validation("No active AWS account is configured."))?,
    };
    let resolved = resolve_aws_auth(app, &account).await?;
    diagnostics::append_log_line(
        "INFO",
        &format!(
            "AWS auth resolved account={} method={:?} creds={}",
            account.id, account.auth_method, resolved.fingerprint
        ),
    );

    Ok(AwsRuntime {
        account,
        config: resolved.config,
        auth_fingerprint: resolved.fingerprint,
    })
}

impl AwsRuntime {
    pub fn annotate_aws_error(&self, mut error: AppError) -> AppError {
        let hint = match self.account.auth_method {
            AwsAuthMethod::MfaSession => {
                " Using IAM User + MFA temporary credentials (GetSessionToken). Caller identity remains the IAM user; if EMR actions require a role, configure this account as Assume Role with MFA instead."
            }
            AwsAuthMethod::AssumeRole => {
                " Using AssumeRole temporary credentials."
            }
            AwsAuthMethod::Sso => " Using IAM Identity Center (SSO) role credentials.",
            AwsAuthMethod::AccessKey => " Using long-term access keys.",
        };
        let suffix = format!(" [{};{}]", self.auth_fingerprint, hint.trim());
        let message = format!("{}{suffix}", error.message);
        error.message = message.into();
        error
    }
}
