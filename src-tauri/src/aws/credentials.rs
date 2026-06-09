use crate::error::{AppError, AppResult};
use crate::models::AwsCredentialsInput;
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_types::region::Region;

const KEYRING_SERVICE: &str = "emr-management-tool";
const KEYRING_USER: &str = "aws-access-key";
const KEYRING_SECRET: &str = "aws-secret-key";

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

pub fn save_credentials(credentials: &AwsCredentialsInput) -> AppResult<()> {
    keyring::use_native_store(false).map_err(|error| AppError::Storage(error.to_string()))?;
    keyring_core::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| AppError::Storage(error.to_string()))?
        .set_password(&credentials.access_key_id)
        .map_err(|error| AppError::Storage(error.to_string()))?;
    keyring_core::Entry::new(KEYRING_SERVICE, KEYRING_SECRET)
        .map_err(|error| AppError::Storage(error.to_string()))?
        .set_password(&credentials.secret_access_key)
        .map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(())
}

pub fn clear_credentials() -> AppResult<()> {
    keyring::use_native_store(false).map_err(|error| AppError::Storage(error.to_string()))?;
    for user in [KEYRING_USER, KEYRING_SECRET] {
        let entry = keyring_core::Entry::new(KEYRING_SERVICE, user).map_err(|error| AppError::Storage(error.to_string()))?;
        let _ = entry.delete_credential();
    }
    Ok(())
}
