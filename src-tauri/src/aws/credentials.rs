use crate::error::{AppError, AppResult};
use crate::models::{AwsAccount, AwsCredentialsInput};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_types::region::Region;

const KEYRING_SERVICE: &str = "emr-management-tool";
const KEYRING_USER: &str = "default/access_key";
const KEYRING_SECRET: &str = "default/secret_key";

pub async fn aws_config_from_credentials(credentials: &AwsCredentialsInput) -> aws_config::SdkConfig {
    let provider = Credentials::new(
        credentials.access_key_id.clone(),
        credentials.secret_access_key.clone(),
        None,
        None,
        "emr-management-tool",
    );

    aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(credentials.region.clone()))
        .credentials_provider(provider)
        .load()
        .await
}

pub async fn aws_config_from_account(account: &AwsAccount) -> AppResult<aws_config::SdkConfig> {
    let access_key_id = read_account_secret(&account.id, "access_key")?;
    let secret_access_key = read_account_secret(&account.id, "secret_key")?;
    Ok(aws_config_from_credentials(&AwsCredentialsInput {
        access_key_id,
        secret_access_key,
        region: account.region.clone(),
    })
    .await)
}

pub fn credential_key(account_id: &str, secret_name: &str) -> String {
    format!("{account_id}/{secret_name}")
}

pub fn save_account_credentials(account_id: &str, access_key_id: &str, secret_access_key: &str) -> AppResult<()> {
    keyring::use_native_store(false).map_err(|error| AppError::storage(error.to_string()))?;
    keyring_core::Entry::new(KEYRING_SERVICE, &credential_key(account_id, "access_key"))
        .map_err(|error| AppError::storage(error.to_string()))?
        .set_password(access_key_id)
        .map_err(|error| AppError::storage(error.to_string()))?;
    keyring_core::Entry::new(KEYRING_SERVICE, &credential_key(account_id, "secret_key"))
        .map_err(|error| AppError::storage(error.to_string()))?
        .set_password(secret_access_key)
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub fn read_account_secret(account_id: &str, secret_name: &str) -> AppResult<String> {
    keyring::use_native_store(false).map_err(|error| AppError::storage(error.to_string()))?;
    keyring_core::Entry::new(KEYRING_SERVICE, &credential_key(account_id, secret_name))
        .map_err(|error| AppError::storage(error.to_string()))?
        .get_password()
        .map_err(|error| AppError::storage(error.to_string()))
}

pub fn clear_account_credentials(account_id: &str) -> AppResult<()> {
    keyring::use_native_store(false).map_err(|error| AppError::storage(error.to_string()))?;
    for secret_name in ["access_key", "secret_key"] {
        let entry = keyring_core::Entry::new(KEYRING_SERVICE, &credential_key(account_id, secret_name))
            .map_err(|error| AppError::storage(error.to_string()))?;
        entry
            .delete_credential()
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    Ok(())
}

pub fn save_credentials(credentials: &AwsCredentialsInput) -> AppResult<()> {
    keyring::use_native_store(false).map_err(|error| AppError::storage(error.to_string()))?;
    keyring_core::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| AppError::storage(error.to_string()))?
        .set_password(&credentials.access_key_id)
        .map_err(|error| AppError::storage(error.to_string()))?;
    keyring_core::Entry::new(KEYRING_SERVICE, KEYRING_SECRET)
        .map_err(|error| AppError::storage(error.to_string()))?
        .set_password(&credentials.secret_access_key)
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub fn clear_credentials() -> AppResult<()> {
    keyring::use_native_store(false).map_err(|error| AppError::storage(error.to_string()))?;
    for user in [KEYRING_USER, KEYRING_SECRET] {
        let entry = keyring_core::Entry::new(KEYRING_SERVICE, user).map_err(|error| AppError::storage(error.to_string()))?;
        entry.delete_credential().map_err(|error| AppError::storage(error.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::credential_key;

    #[test]
    fn credential_key_is_scoped_by_account_id() {
        assert_eq!(
            credential_key("acct-prod", "secret_key"),
            "acct-prod/secret_key"
        );
    }
}
