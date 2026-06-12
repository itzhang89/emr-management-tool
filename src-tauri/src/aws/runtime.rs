use crate::aws::credentials::aws_config_from_account;
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{AwsAccount, AwsCommandContext};
use tauri::AppHandle;

pub struct AwsRuntime {
    pub account: AwsAccount,
    pub config: aws_config::SdkConfig,
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
    let config = aws_config_from_account(app, &account).await?;

    Ok(AwsRuntime { account, config })
}
