//! Resolve DBHub dial credentials from the local keychain or AWS Secrets Manager.

use crate::error::{AppError, AppResult};
use crate::models::{AwsCommandContext, DbAuthMode, DbConnection};
use tauri::AppHandle;

fn connection_secret_key(id: &str) -> String {
    format!("db/{id}/password")
}

/// Which password a dial uses, in order of authority: what the caller typed
/// just now, then what the bound secret carries, then what was stored locally.
///
/// The local store is last for a secret-backed connection the same way the
/// connection's own host and username survive a secret that leaves them out:
/// the secret wins where it speaks, and the saved value is the fallback.
fn choose_password(
    typed: Option<String>,
    from_secret: Option<String>,
    stored: Option<String>,
) -> Option<String> {
    // Whitespace-only counts as absent, but the value itself is passed through
    // untouched — a password may legitimately start or end with a space.
    let non_empty = |value: String| Some(value).filter(|value| !value.trim().is_empty());
    typed
        .and_then(non_empty)
        .or_else(|| from_secret.and_then(non_empty))
        .or_else(|| stored.and_then(non_empty))
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
            let from_secret =
                crate::aws::secrets_manager::apply_db_secret_overlay(&mut overlayed, &fields);
            let stored =
                crate::secrets::read_optional_secret(app, &connection_secret_key(&connection.id))
                    .ok()
                    .flatten();
            let password = choose_password(typed_password, from_secret, stored);
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
            if password.is_none() {
                return Err(AppError::validation(
                    "Password is missing: add a password to the bound secret JSON, or enter one on the connection form.",
                ));
            }
            Ok((overlayed, password))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::choose_password;

    fn owned(value: &str) -> Option<String> {
        Some(value.to_string())
    }

    #[test]
    fn typed_password_beats_the_secret() {
        assert_eq!(
            choose_password(owned("typed"), owned("secret"), owned("stored")).as_deref(),
            Some("typed")
        );
    }

    #[test]
    fn the_secret_beats_the_stored_one() {
        assert_eq!(
            choose_password(None, owned("secret"), owned("stored")).as_deref(),
            Some("secret")
        );
    }

    #[test]
    fn the_stored_password_covers_a_secret_without_one() {
        assert_eq!(
            choose_password(None, None, owned("stored")).as_deref(),
            Some("stored")
        );
    }

    #[test]
    fn blank_values_do_not_count_as_credentials() {
        assert_eq!(
            choose_password(Some(String::new()), owned("  "), owned("")).as_deref(),
            None
        );
    }

    #[test]
    fn nothing_anywhere_is_no_password() {
        assert_eq!(choose_password(None, None, None), None);
    }
}
