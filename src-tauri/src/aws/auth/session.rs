use crate::aws::credentials::{
    aws_config_from_credentials, credential_key, StoredAwsCredentials,
};
use crate::error::AppResult;
use crate::models::AwsCredentialsInput;
use crate::secrets::{
    delete_secret, read_optional_secret, write_optional_secret, write_secret,
};
use chrono::{DateTime, Duration, Utc};
use tauri::AppHandle;

pub const SESSION_SKEW: Duration = Duration::minutes(5);

/// Temporary session secrets (MFA GetSessionToken / AssumeRole / SSO role creds).
/// Intentionally distinct from long-term `imported_session_token` so saving base
/// access keys cannot wipe or collide with an active MFA/role session.
const SESSION_SECRETS: &[&str] = &[
    "session_access_key",
    "session_secret_key",
    "session_security_token",
    "session_expires_at",
    // Legacy key used before the collision fix; still cleared on wipe.
    "session_token",
];

const SSO_SECRETS: &[&str] = &[
    "sso_client_id",
    "sso_client_secret",
    "sso_client_expires_at",
    "sso_access_token",
    "sso_access_token_expires_at",
    "sso_refresh_token",
];

#[derive(Debug, Clone)]
pub struct CachedSession {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: String,
    pub expires_at: DateTime<Utc>,
}

impl CachedSession {
    pub fn is_usable(&self) -> bool {
        self.expires_at > Utc::now() + SESSION_SKEW
    }

    pub fn fingerprint(&self) -> String {
        mask_key_prefix(&self.access_key_id)
    }
}

pub fn mask_key_prefix(access_key_id: &str) -> String {
    let trimmed = access_key_id.trim();
    if trimmed.len() <= 4 {
        return "****".to_string();
    }
    format!("{}…", &trimmed[..4])
}

pub fn read_cached_session(app: &AppHandle, account_id: &str) -> AppResult<Option<CachedSession>> {
    let access_key_id = match read_optional_secret(app, &credential_key(account_id, "session_access_key"))? {
        Some(value) if !value.trim().is_empty() => value,
        _ => return Ok(None),
    };
    let secret_access_key =
        match read_optional_secret(app, &credential_key(account_id, "session_secret_key"))? {
            Some(value) if !value.trim().is_empty() => value,
            _ => return Ok(None),
        };
    // Prefer the collision-safe key; fall back to the legacy shared name.
    let (session_token, from_legacy_key) = match read_optional_secret(
        app,
        &credential_key(account_id, "session_security_token"),
    )? {
        Some(value) if !value.trim().is_empty() => (value, false),
        _ => match read_optional_secret(app, &credential_key(account_id, "session_token"))? {
            Some(value) if !value.trim().is_empty() => (value, true),
            _ => return Ok(None),
        },
    };
    let expires_at =
        match read_optional_secret(app, &credential_key(account_id, "session_expires_at"))? {
            Some(value) => DateTime::parse_from_rfc3339(&value)
                .map(|dt| dt.with_timezone(&Utc))
                .ok(),
            None => None,
        };
    let Some(expires_at) = expires_at else {
        return Ok(None);
    };

    if from_legacy_key {
        // Migrate off the shared key so long-term credential updates cannot wipe
        // or collide with this temporary session.
        let _ = save_cached_session(
            app,
            account_id,
            &access_key_id,
            &secret_access_key,
            &session_token,
            expires_at,
        );
    }

    Ok(Some(CachedSession {
        access_key_id,
        secret_access_key,
        session_token,
        expires_at,
    }))
}

pub fn save_cached_session(
    app: &AppHandle,
    account_id: &str,
    access_key_id: &str,
    secret_access_key: &str,
    session_token: &str,
    expires_at: DateTime<Utc>,
) -> AppResult<()> {
    write_secret(
        app,
        &credential_key(account_id, "session_access_key"),
        access_key_id,
    )?;
    write_secret(
        app,
        &credential_key(account_id, "session_secret_key"),
        secret_access_key,
    )?;
    write_secret(
        app,
        &credential_key(account_id, "session_security_token"),
        session_token,
    )?;
    write_secret(
        app,
        &credential_key(account_id, "session_expires_at"),
        &expires_at.to_rfc3339(),
    )?;
    // Drop the legacy shared key so long-term credential reads cannot pick up
    // the temporary session token by accident.
    delete_secret(app, &credential_key(account_id, "session_token"))?;
    Ok(())
}

pub fn clear_cached_session(app: &AppHandle, account_id: &str) -> AppResult<()> {
    for secret_name in SESSION_SECRETS {
        delete_secret(app, &credential_key(account_id, secret_name))?;
    }
    Ok(())
}

pub fn clear_sso_token_secrets(app: &AppHandle, account_id: &str) -> AppResult<()> {
    for secret_name in SSO_SECRETS {
        delete_secret(app, &credential_key(account_id, secret_name))?;
    }
    Ok(())
}

pub fn clear_all_auth_secrets(app: &AppHandle, account_id: &str) -> AppResult<()> {
    for secret_name in [
        "access_key",
        "secret_key",
        "imported_session_token",
        "session_token",
        "session_access_key",
        "session_secret_key",
        "session_security_token",
        "session_expires_at",
        "sso_client_id",
        "sso_client_secret",
        "sso_client_expires_at",
        "sso_access_token",
        "sso_access_token_expires_at",
        "sso_refresh_token",
    ] {
        delete_secret(app, &credential_key(account_id, secret_name))?;
    }
    Ok(())
}

pub async fn sdk_config_from_session(
    session: &CachedSession,
    region: &str,
) -> aws_config::SdkConfig {
    aws_config_from_credentials(&AwsCredentialsInput {
        access_key_id: session.access_key_id.clone(),
        secret_access_key: session.secret_access_key.clone(),
        session_token: Some(session.session_token.clone()),
        region: region.to_string(),
    })
    .await
}

pub async fn sdk_config_from_static(
    credentials: &StoredAwsCredentials,
    region: &str,
) -> aws_config::SdkConfig {
    aws_config_from_credentials(&AwsCredentialsInput {
        access_key_id: credentials.access_key_id.clone(),
        secret_access_key: credentials.secret_access_key.clone(),
        session_token: credentials.session_token.clone(),
        region: region.to_string(),
    })
    .await
}

pub fn write_sso_client(
    app: &AppHandle,
    account_id: &str,
    client_id: &str,
    client_secret: &str,
    expires_at: Option<DateTime<Utc>>,
) -> AppResult<()> {
    write_secret(app, &credential_key(account_id, "sso_client_id"), client_id)?;
    write_secret(
        app,
        &credential_key(account_id, "sso_client_secret"),
        client_secret,
    )?;
    write_optional_secret(
        app,
        &credential_key(account_id, "sso_client_expires_at"),
        expires_at.map(|value| value.to_rfc3339()).as_deref(),
    )?;
    Ok(())
}

pub fn read_sso_client(
    app: &AppHandle,
    account_id: &str,
) -> AppResult<Option<(String, String, Option<DateTime<Utc>>)>> {
    let client_id = match read_optional_secret(app, &credential_key(account_id, "sso_client_id"))? {
        Some(value) if !value.trim().is_empty() => value,
        _ => return Ok(None),
    };
    let client_secret =
        match read_optional_secret(app, &credential_key(account_id, "sso_client_secret"))? {
            Some(value) if !value.trim().is_empty() => value,
            _ => return Ok(None),
        };
    let expires_at =
        read_optional_secret(app, &credential_key(account_id, "sso_client_expires_at"))?
            .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
            .map(|dt| dt.with_timezone(&Utc));
    if let Some(expires_at) = expires_at {
        if expires_at <= Utc::now() + SESSION_SKEW {
            return Ok(None);
        }
    }
    Ok(Some((client_id, client_secret, expires_at)))
}

pub fn write_sso_tokens(
    app: &AppHandle,
    account_id: &str,
    access_token: &str,
    access_token_expires_at: DateTime<Utc>,
    refresh_token: Option<&str>,
) -> AppResult<()> {
    write_secret(
        app,
        &credential_key(account_id, "sso_access_token"),
        access_token,
    )?;
    write_secret(
        app,
        &credential_key(account_id, "sso_access_token_expires_at"),
        &access_token_expires_at.to_rfc3339(),
    )?;
    write_optional_secret(
        app,
        &credential_key(account_id, "sso_refresh_token"),
        refresh_token,
    )?;
    Ok(())
}

pub fn read_sso_access_token(
    app: &AppHandle,
    account_id: &str,
) -> AppResult<Option<(String, DateTime<Utc>)>> {
    let access_token =
        match read_optional_secret(app, &credential_key(account_id, "sso_access_token"))? {
            Some(value) if !value.trim().is_empty() => value,
            _ => return Ok(None),
        };
    let expires_at =
        match read_optional_secret(app, &credential_key(account_id, "sso_access_token_expires_at"))?
        {
            Some(value) => DateTime::parse_from_rfc3339(&value)
                .map(|dt| dt.with_timezone(&Utc))
                .ok(),
            None => None,
        };
    let Some(expires_at) = expires_at else {
        return Ok(None);
    };
    Ok(Some((access_token, expires_at)))
}

pub fn read_sso_refresh_token(app: &AppHandle, account_id: &str) -> AppResult<Option<String>> {
    Ok(
        read_optional_secret(app, &credential_key(account_id, "sso_refresh_token"))?
            .filter(|value| !value.trim().is_empty()),
    )
}
