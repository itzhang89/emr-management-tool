//! Resolve DBHub dial credentials from the local keychain or AWS Secrets Manager.

use crate::error::{AppError, AppResult};
use crate::models::{AwsCommandContext, DbAuthMode, DbConnection};
use tauri::AppHandle;

fn connection_secret_key(id: &str) -> String {
    format!("db/{id}/password")
}

/// Resolve dial credentials: local keychain for manual, Secrets Manager JSON for
/// `aws_secret` (overlays host/user/port/database onto a cloned connection).
pub async fn resolve_for_dial(
    app: &AppHandle,
    connection: &DbConnection,
    typed_password: Option<String>,
) -> AppResult<(DbConnection, Option<String>)> {
    match connection.auth_mode {
        DbAuthMode::Manual => {
            let password = match typed_password.filter(|value| !value.is_empty()) {
                Some(typed) => Some(typed),
                None => {
                    crate::secrets::read_optional_secret(app, &connection_secret_key(&connection.id))
                        .unwrap_or(None)
                }
            };
            Ok((connection.clone(), password))
        }
        DbAuthMode::AwsSecret => {
            let secret_arn = connection
                .secret_arn
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::validation("Connection is missing secretArn for aws_secret auth.")
                })?;
            let runtime = crate::aws::runtime::runtime_for_context(
                app,
                AwsCommandContext {
                    account_id: Some(connection.account_id.clone()),
                },
            )
            .await?;
            let client = aws_sdk_secretsmanager::Client::new(&runtime.config);
            let response = client
                .get_secret_value()
                .secret_id(secret_arn)
                .send()
                .await
                .map_err(|error| {
                    AppError::aws_for_account_sdk(
                        "secretsmanager",
                        runtime.account.id.clone(),
                        error,
                    )
                })?;
            let secret_string = response.secret_string().map(str::to_string).ok_or_else(|| {
                AppError::validation(
                    "Bound secret has no SecretString (binary secrets are not supported).",
                )
            })?;
            let fields = crate::aws::secrets_manager::parse_db_secret_json(&secret_string)?;
            let mut overlayed = connection.clone();
            let password =
                crate::aws::secrets_manager::apply_db_secret_overlay(&mut overlayed, &fields);
            let password = typed_password
                .filter(|value| !value.is_empty())
                .or(password);
            if overlayed.host.trim().is_empty() {
                return Err(AppError::validation(
                    "Host is missing after applying the bound secret. Set host in the secret JSON or the connection form.",
                ));
            }
            if overlayed.username.trim().is_empty() {
                return Err(AppError::validation(
                    "Username is missing after applying the bound secret.",
                ));
            }
            if password.as_deref().map(str::is_empty).unwrap_or(true) {
                return Err(AppError::validation(
                    "Password is missing in the bound secret JSON.",
                ));
            }
            Ok((overlayed, password))
        }
    }
}
