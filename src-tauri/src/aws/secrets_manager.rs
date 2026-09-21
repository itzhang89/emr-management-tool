//! AWS Secrets Manager helpers: list/describe/create plus JSON overlay used by
//! DBHub when a connection binds a secret by ARN.
//!
//! SecretString never lands in SQLite. List/describe DTOs omit it; reveal/copy
//! and dial-time resolve are the only readers.

use crate::error::{AppError, AppResult};
use crate::models::{DbConnection, SecretSummary, SecretTag};
use aws_sdk_secretsmanager::types::Tag;
use chrono::{DateTime, Utc};
use serde::Deserialize;

/// Who created the secret from this app. Written once, on Create.
pub const TAG_CREATED_BY: &str = "createdBy";
/// Who last wrote the secret from this app. Refreshed on every Update.
pub const TAG_LAST_MODIFIED_BY: &str = "lastModifiedBy";

const LIST_PAGE_SIZE: i32 = 100;
const LIST_HARD_CAP: usize = 2000;

/// Fields a DBHub JSON secret may carry. Absent keys leave the connection row
/// untouched; empty strings are treated as absent.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct DbSecretFields {
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<i64>,
    #[serde(default)]
    pub database: Option<String>,
}

pub fn parse_db_secret_json(secret_string: &str) -> AppResult<DbSecretFields> {
    let value: serde_json::Value = serde_json::from_str(secret_string).map_err(|error| {
        AppError::validation(format!(
            "Secret value is not valid JSON: {error}. Expected an object with username/password/host/port/database."
        ))
    })?;
    if !value.is_object() {
        return Err(AppError::validation(
            "Secret value must be a JSON object with username/password/host/port/database.",
        ));
    }
    serde_json::from_value(value).map_err(|error| {
        AppError::validation(format!("Secret JSON could not be parsed: {error}"))
    })
}

/// Overlay non-empty secret fields onto a connection. Returns the password to
/// use for the dial (secret password if present, else `None` so the caller can
/// fall back to the local keychain).
pub fn apply_db_secret_overlay(
    connection: &mut DbConnection,
    fields: &DbSecretFields,
) -> Option<String> {
    if let Some(username) = non_empty(fields.username.as_deref()) {
        connection.username = username.to_string();
    }
    if let Some(host) = non_empty(fields.host.as_deref()) {
        connection.host = host.to_string();
    }
    if let Some(port) = fields.port.filter(|value| *value > 0 && *value <= 65535) {
        connection.port = port;
    }
    if let Some(database) = fields.database.as_ref() {
        let trimmed = database.trim();
        connection.database = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    non_empty(fields.password.as_deref()).map(str::to_string)
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Tags stamped on Create: the local user is recorded as the creator.
pub fn required_create_tags(created_by: &str) -> Vec<Tag> {
    vec![
        Tag::builder()
            .key(TAG_CREATED_BY)
            .value(created_by)
            .build(),
    ]
}

/// Tags stamped on every Update: whoever wrote last, including secrets another
/// user created.
pub fn modifier_tags(modified_by: &str) -> Vec<Tag> {
    vec![
        Tag::builder()
            .key(TAG_LAST_MODIFIED_BY)
            .value(modified_by)
            .build(),
    ]
}

/// Identity tags are owned by the app, never by the caller: they always name the
/// local user, so a UI client cannot attribute a write to somebody else.
fn is_identity_tag(key: &str) -> bool {
    key == TAG_CREATED_BY || key == TAG_LAST_MODIFIED_BY
}

pub fn merge_create_tags(
    created_by: &str,
    extra: &[SecretTag],
) -> AppResult<Vec<Tag>> {
    let mut tags = required_create_tags(created_by);
    for tag in extra {
        let key = tag.key.trim();
        let value = tag.value.trim();
        if key.is_empty() {
            return Err(AppError::validation("Secret tag keys cannot be empty."));
        }
        if is_identity_tag(key) {
            if value != created_by {
                return Err(AppError::validation(format!(
                    "{key} tag must be the local user ({created_by}); forging another user is not allowed."
                )));
            }
            continue;
        }
        tags.push(Tag::builder().key(key).value(value).build());
    }
    Ok(tags)
}

pub fn map_secret_list_entry(
    entry: &aws_sdk_secretsmanager::types::SecretListEntry,
) -> Option<SecretSummary> {
    let name = entry.name()?.to_string();
    let arn = entry.arn()?.to_string();
    Some(SecretSummary {
        name,
        arn,
        description: entry.description().map(str::to_string),
        tags: entry
            .tags()
            .iter()
            .filter_map(|tag| {
                Some(SecretTag {
                    key: tag.key()?.to_string(),
                    value: tag.value().unwrap_or("").to_string(),
                })
            })
            .collect(),
        last_changed_date: entry
            .last_changed_date()
            .and_then(system_time_to_rfc3339),
    })
}

fn system_time_to_rfc3339(
    value: &aws_smithy_types::DateTime,
) -> Option<String> {
    let secs = value.secs();
    let nanos = value.subsec_nanos();
    DateTime::<Utc>::from_timestamp(secs, nanos).map(|dt| dt.to_rfc3339())
}

pub async fn list_all_secrets(
    client: &aws_sdk_secretsmanager::Client,
) -> AppResult<Vec<SecretSummary>> {
    let mut out = Vec::new();
    let mut next_token: Option<String> = None;
    loop {
        let mut operation = client.list_secrets().max_results(LIST_PAGE_SIZE);
        if let Some(token) = next_token.as_deref() {
            operation = operation.next_token(token);
        }
        let response = operation.send().await.map_err(|error| {
            AppError::aws_sdk("secretsmanager", error)
        })?;
        for entry in response.secret_list() {
            if let Some(summary) = map_secret_list_entry(entry) {
                out.push(summary);
            }
        }
        if out.len() >= LIST_HARD_CAP {
            break;
        }
        next_token = response.next_token().map(str::to_string);
        if next_token.is_none() {
            break;
        }
    }
    out.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(out)
}

pub async fn get_secret_string(
    client: &aws_sdk_secretsmanager::Client,
    secret_id: &str,
) -> AppResult<String> {
    let response = client
        .get_secret_value()
        .secret_id(secret_id)
        .send()
        .await
        .map_err(|error| AppError::aws_sdk("secretsmanager", error))?;
    response.secret_string().map(str::to_string).ok_or_else(|| {
        AppError::validation(
            "Secret has no SecretString (binary secrets are not supported for DBHub).",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DbAuthMode, DbConnectionKind, DbReadOnlyPolicy};

    fn connection() -> DbConnection {
        DbConnection {
            id: "c1".into(),
            account_id: "a1".into(),
            kind: DbConnectionKind::Mysql,
            name: "sales".into(),
            host: "fallback.host".into(),
            port: 3306,
            database: Some("fallback_db".into()),
            username: "fallback_user".into(),
            network_profile_id: None,
            show_as_tab: false,
            enabled_for_ai: false,
            ai_read_only_policy: DbReadOnlyPolicy::SelectOnly,
            allow_writes: false,
            auth_mode: DbAuthMode::Manual,
            secret_arn: None,
            secret_name: None,
            sort_order: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn parse_and_overlay_json_secret() {
        let fields = parse_db_secret_json(
            r#"{"username":"bi","password":"s3cret","host":"db.internal","port":3307,"database":"sales"}"#,
        )
        .expect("parse");
        let mut connection = connection();
        let password = apply_db_secret_overlay(&mut connection, &fields);
        assert_eq!(password.as_deref(), Some("s3cret"));
        assert_eq!(connection.username, "bi");
        assert_eq!(connection.host, "db.internal");
        assert_eq!(connection.port, 3307);
        assert_eq!(connection.database.as_deref(), Some("sales"));
    }

    #[test]
    fn overlay_skips_empty_fields() {
        let fields = parse_db_secret_json(r#"{"password":"only"}"#).expect("parse");
        let mut connection = connection();
        let password = apply_db_secret_overlay(&mut connection, &fields);
        assert_eq!(password.as_deref(), Some("only"));
        assert_eq!(connection.host, "fallback.host");
        assert_eq!(connection.username, "fallback_user");
    }

    #[test]
    fn merge_tags_rejects_forged_created_by() {
        let err = merge_create_tags(
            "alice",
            &[SecretTag {
                key: "createdBy".into(),
                value: "bob".into(),
            }],
        )
        .expect_err("forge");
        assert!(err.message.contains("createdBy"));
    }

    #[test]
    fn merge_tags_rejects_forged_last_modified_by() {
        let err = merge_create_tags(
            "alice",
            &[SecretTag {
                key: "lastModifiedBy".into(),
                value: "bob".into(),
            }],
        )
        .expect_err("forge");
        assert!(err.message.contains("lastModifiedBy"));
    }

    #[test]
    fn merge_tags_keeps_required_and_extras() {
        let tags = merge_create_tags(
            "alice",
            &[SecretTag {
                key: "purpose".into(),
                value: "dbhub".into(),
            }],
        )
        .expect("merge");
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].key(), Some(TAG_CREATED_BY));
        assert_eq!(tags[0].value(), Some("alice"));
        assert_eq!(tags[1].key(), Some("purpose"));
    }

    #[test]
    fn merge_tags_accepts_caller_supplied_identity_tag_for_local_user() {
        let tags = merge_create_tags(
            "alice",
            &[SecretTag {
                key: "createdBy".into(),
                value: "alice".into(),
            }],
        )
        .expect("merge");
        assert_eq!(tags.len(), 1);
    }

    #[test]
    fn modifier_tags_stamp_the_local_user() {
        let tags = modifier_tags("bob");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].key(), Some(TAG_LAST_MODIFIED_BY));
        assert_eq!(tags[0].value(), Some("bob"));
    }

    #[test]
    fn reject_non_object_json() {
        assert!(parse_db_secret_json(r#""just-a-string""#).is_err());
    }
}
