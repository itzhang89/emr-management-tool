use crate::aws::runtime::runtime_for_context;
use crate::aws::s3_rules::s3_object_editability;
use crate::error::{AppError, AppResult};
use crate::models::{AwsCommandContext, S3Bucket, S3ListObjectsRequest, S3ObjectEntry, S3ObjectRequest, S3TextObject};
use aws_sdk_s3::primitives::ByteStream;
use chrono::Utc;

#[tauri::command]
pub async fn list_s3_buckets() -> AppResult<Vec<S3Bucket>> {
    let runtime = runtime_for_context(AwsCommandContext { account_id: None }).await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    let response = client
        .list_buckets()
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;

    Ok(response
        .buckets()
        .iter()
        .map(|bucket| S3Bucket {
            name: bucket.name().unwrap_or_default().to_string(),
            created_at: bucket.creation_date().map(|created_at| created_at.to_string()),
        })
        .collect())
}

#[tauri::command]
pub async fn list_s3_objects(request: S3ListObjectsRequest) -> AppResult<Vec<S3ObjectEntry>> {
    if request.bucket.trim().is_empty() {
        return Err(AppError::validation("Bucket is required."));
    }

    let runtime = runtime_for_context(AwsCommandContext {
        account_id: request.account_id.clone(),
    })
    .await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    let mut operation = client
        .list_objects_v2()
        .bucket(&request.bucket)
        .delimiter("/")
        .prefix(request.prefix.clone().unwrap_or_default());
    if let Some(token) = request.continuation_token {
        operation = operation.continuation_token(token);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;
    let mut objects: Vec<S3ObjectEntry> = response
        .common_prefixes()
        .iter()
        .filter_map(|prefix| prefix.prefix())
        .map(|prefix| object(&request.bucket, prefix.to_string(), 0, "folder", None, None))
        .collect();
    objects.extend(response.contents().iter().map(|object_summary| {
        object(
            &request.bucket,
            object_summary.key().unwrap_or_default().to_string(),
            object_summary.size().unwrap_or_default(),
            "file",
            object_summary.last_modified().map(|date| date.to_string()),
            object_summary.e_tag().map(ToString::to_string),
        )
    }));
    Ok(objects)
}

#[tauri::command]
pub async fn get_s3_text_object(request: S3ObjectRequest) -> AppResult<S3TextObject> {
    let runtime = runtime_for_context(AwsCommandContext {
        account_id: request.account_id.clone(),
    })
    .await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    let response = client
        .get_object()
        .bucket(&request.bucket)
        .key(&request.key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;
    let etag = response.e_tag().map(ToString::to_string);
    let content_type = response.content_type().map(ToString::to_string);
    let last_modified = response.last_modified().map(|date| date.to_string());
    let bytes = response
        .body
        .collect()
        .await
        .map_err(|error| AppError::aws("s3", error))?
        .into_bytes();
    let editability = s3_object_editability(&request.key, bytes.len() as u64);
    if !editability.previewable {
        return Err(AppError::validation(
            editability.reason.unwrap_or_else(|| "Object cannot be previewed.".to_string()),
        ));
    }

    let content = String::from_utf8(bytes.to_vec())
        .map_err(|_| AppError::validation("Object is not valid UTF-8 text."))?;
    Ok(S3TextObject {
        account_id: request.account_id,
        bucket: request.bucket,
        key: request.key,
        content,
        etag,
        content_type,
        last_modified,
    })
}

#[tauri::command]
pub async fn put_s3_text_object(request: S3TextObject) -> AppResult<S3TextObject> {
    let editability = s3_object_editability(&request.key, request.content.len() as u64);
    if !editability.editable {
        return Err(AppError::validation(
            editability.reason.unwrap_or_else(|| "Object cannot be edited.".to_string()),
        ));
    }

    let runtime = runtime_for_context(AwsCommandContext {
        account_id: request.account_id.clone(),
    })
    .await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    let mut operation = client
        .put_object()
        .bucket(&request.bucket)
        .key(&request.key)
        .body(ByteStream::from(request.content.clone().into_bytes()));
    if let Some(content_type) = request.content_type.clone() {
        operation = operation.content_type(content_type);
    }
    if let Some(etag) = request.etag.clone() {
        operation = operation.if_match(etag);
    }
    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;

    Ok(S3TextObject {
        etag: response.e_tag().map(ToString::to_string),
        last_modified: Some(Utc::now().to_rfc3339()),
        ..request
    })
}

#[tauri::command]
pub async fn upload_s3_object(request: S3TextObject) -> AppResult<S3ObjectEntry> {
    let saved = put_s3_text_object(request).await?;
    Ok(object(
        &saved.bucket,
        saved.key,
        saved.content.len() as i64,
        "file",
        saved.last_modified,
        saved.etag,
    ))
}

#[tauri::command]
pub async fn download_s3_object(request: S3ObjectRequest) -> AppResult<S3TextObject> {
    get_s3_text_object(request).await
}

#[tauri::command]
pub async fn delete_s3_object(request: S3ObjectRequest) -> AppResult<()> {
    if request.bucket.trim().is_empty() || request.key.trim().is_empty() {
        return Err(AppError::validation("Bucket and key are required."));
    }

    let runtime = runtime_for_context(AwsCommandContext {
        account_id: request.account_id.clone(),
    })
    .await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    client
        .delete_object()
        .bucket(&request.bucket)
        .key(&request.key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;
    Ok(())
}

fn object(bucket: &str, key: String, size: i64, kind: &str, last_modified: Option<String>, etag: Option<String>) -> S3ObjectEntry {
    S3ObjectEntry {
        bucket: bucket.to_string(),
        key,
        kind: kind.to_string(),
        size,
        last_modified,
        etag,
    }
}
