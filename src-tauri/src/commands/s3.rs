use crate::aws::s3_rules::s3_object_editability;
use crate::error::{AppError, AppResult};
use crate::models::{S3Bucket, S3ListObjectsRequest, S3ObjectEntry, S3ObjectRequest, S3TextObject};

#[tauri::command]
pub async fn list_s3_buckets() -> AppResult<Vec<S3Bucket>> {
    Ok(vec![S3Bucket {
        name: "analytics-bucket".to_string(),
        created_at: Some("2026-01-01T00:00:00Z".to_string()),
    }])
}

#[tauri::command]
pub async fn list_s3_objects(request: S3ListObjectsRequest) -> AppResult<Vec<S3ObjectEntry>> {
    if request.bucket.trim().is_empty() {
        return Err(AppError::Validation("Bucket is required.".to_string()));
    }

    let prefix = request.prefix.unwrap_or_default();
    Ok(vec![
        object(&request.bucket, format!("{prefix}scripts/etl.sql"), 2048, "file"),
        object(&request.bucket, format!("{prefix}config/job.json"), 1024, "file"),
        object(&request.bucket, format!("{prefix}jars/app.jar"), 24_000_000, "file"),
    ])
}

#[tauri::command]
pub async fn get_s3_text_object(request: S3ObjectRequest) -> AppResult<S3TextObject> {
    let editability = s3_object_editability(&request.key, 2048);
    if !editability.previewable {
        return Err(AppError::Validation(
            editability.reason.unwrap_or_else(|| "Object cannot be previewed.".to_string()),
        ));
    }

    Ok(S3TextObject {
        bucket: request.bucket,
        key: request.key,
        content: "select *\nfrom source.events\nwhere dt = '${date}';\n".to_string(),
        etag: Some("\"local-preview\"".to_string()),
        content_type: Some("text/plain".to_string()),
        last_modified: Some("2026-06-09T00:00:00Z".to_string()),
    })
}

#[tauri::command]
pub async fn put_s3_text_object(request: S3TextObject) -> AppResult<S3TextObject> {
    let editability = s3_object_editability(&request.key, request.content.len() as u64);
    if !editability.editable {
        return Err(AppError::Validation(
            editability.reason.unwrap_or_else(|| "Object cannot be edited.".to_string()),
        ));
    }

    Ok(S3TextObject {
        etag: Some(format!("\"{}\"", uuid::Uuid::new_v4())),
        last_modified: Some(chrono::Utc::now().to_rfc3339()),
        ..request
    })
}

#[tauri::command]
pub async fn upload_s3_object(request: S3TextObject) -> AppResult<S3ObjectEntry> {
    Ok(object(&request.bucket, request.key, request.content.len() as i64, "file"))
}

#[tauri::command]
pub async fn download_s3_object(request: S3ObjectRequest) -> AppResult<S3TextObject> {
    get_s3_text_object(request).await
}

#[tauri::command]
pub async fn delete_s3_object(request: S3ObjectRequest) -> AppResult<()> {
    if request.bucket.trim().is_empty() || request.key.trim().is_empty() {
        return Err(AppError::Validation("Bucket and key are required.".to_string()));
    }

    Ok(())
}

fn object(bucket: &str, key: String, size: i64, kind: &str) -> S3ObjectEntry {
    S3ObjectEntry {
        bucket: bucket.to_string(),
        key,
        kind: kind.to_string(),
        size,
        last_modified: Some("2026-06-09T00:00:00Z".to_string()),
        etag: Some("\"local-preview\"".to_string()),
    }
}
