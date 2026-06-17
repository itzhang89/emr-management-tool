use crate::aws::runtime::AwsRuntime;
use crate::error::{AppError, AppResult};
use aws_sdk_s3::types::BucketLocationConstraint;
use aws_types::region::Region;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

static BUCKET_REGION_CACHE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn default_client(runtime: &AwsRuntime) -> aws_sdk_s3::Client {
    aws_sdk_s3::Client::new(&runtime.config)
}

pub async fn client_for_bucket(runtime: &AwsRuntime, bucket: &str) -> AppResult<aws_sdk_s3::Client> {
    let region = resolve_bucket_region(runtime, bucket).await?;
    Ok(client_for_region(runtime, &region))
}

pub fn remember_bucket_region(account_id: &str, bucket: &str, region: &str) {
    let region = region.trim();
    if region.is_empty() {
        return;
    }
    if let Ok(mut cache) = BUCKET_REGION_CACHE.lock() {
        cache.insert(cache_key(account_id, bucket), region.to_string());
    }
}

fn client_for_region(runtime: &AwsRuntime, region: &str) -> aws_sdk_s3::Client {
    if runtime.account.region == region {
        return aws_sdk_s3::Client::new(&runtime.config);
    }

    let regional_config = runtime
        .config
        .clone()
        .to_builder()
        .region(Region::new(region.to_string()))
        .build();
    aws_sdk_s3::Client::new(&regional_config)
}

async fn resolve_bucket_region(runtime: &AwsRuntime, bucket: &str) -> AppResult<String> {
    if let Some(region) = cached_bucket_region(&runtime.account.id, bucket) {
        return Ok(region);
    }

    let default_client = aws_sdk_s3::Client::new(&runtime.config);
    if let Some(region) = head_bucket_region(&default_client, bucket).await {
        remember_bucket_region(&runtime.account.id, bucket, &region);
        return Ok(region);
    }

    let us_east_config = runtime
        .config
        .clone()
        .to_builder()
        .region(Region::new("us-east-1"))
        .build();
    let lookup_client = aws_sdk_s3::Client::new(&us_east_config);
    if let Some(region) = head_bucket_region(&lookup_client, bucket).await {
        remember_bucket_region(&runtime.account.id, bucket, &region);
        return Ok(region);
    }

    let response = lookup_client
        .get_bucket_location()
        .bucket(bucket)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id.clone(), error))?;
    let region = normalize_bucket_region(response.location_constraint());
    remember_bucket_region(&runtime.account.id, bucket, &region);
    Ok(region)
}

async fn head_bucket_region(client: &aws_sdk_s3::Client, bucket: &str) -> Option<String> {
    let response = client.head_bucket().bucket(bucket).send().await.ok()?;
    response
        .bucket_region()
        .map(str::to_string)
        .filter(|region| !region.is_empty())
}

fn cached_bucket_region(account_id: &str, bucket: &str) -> Option<String> {
    BUCKET_REGION_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(&cache_key(account_id, bucket)).cloned())
}

fn cache_key(account_id: &str, bucket: &str) -> String {
    format!("{account_id}:{bucket}")
}

fn normalize_bucket_region(constraint: Option<&BucketLocationConstraint>) -> String {
    match constraint {
        None => "us-east-1".to_string(),
        Some(BucketLocationConstraint::Eu) => "eu-west-1".to_string(),
        Some(value) => {
            let region = value.as_str();
            if region == "EU" {
                "eu-west-1".to_string()
            } else {
                region.to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_bucket_region;
    use aws_sdk_s3::types::BucketLocationConstraint;

    #[test]
    fn maps_missing_location_constraint_to_us_east_1() {
        assert_eq!(normalize_bucket_region(None), "us-east-1");
    }

    #[test]
    fn maps_legacy_eu_constraint_to_eu_west_1() {
        assert_eq!(
            normalize_bucket_region(Some(&BucketLocationConstraint::Eu)),
            "eu-west-1"
        );
    }

    #[test]
    fn preserves_explicit_region_constraints() {
        assert_eq!(
            normalize_bucket_region(Some(&BucketLocationConstraint::ApSoutheast1)),
            "ap-southeast-1"
        );
    }
}
