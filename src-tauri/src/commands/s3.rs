use crate::aws::runtime::runtime_for_context;
use crate::aws::s3_rules::s3_object_editability;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, S3Bucket, S3JobLogObject, S3JobLogObjectsRequest, S3JobLogObjectsResponse,
    S3ListObjectsRequest, S3ObjectEntry, S3ObjectRequest, S3RenameObjectRequest, S3TextObject,
    S3UploadFromDiskRequest,
};
use aws_sdk_s3::primitives::ByteStream;
use chrono::Utc;
use flate2::read::GzDecoder;
use std::io::Read;
use tauri::AppHandle;

#[tauri::command]
pub async fn list_s3_buckets(app: AppHandle) -> AppResult<Vec<S3Bucket>> {
    let runtime = runtime_for_context(&app, AwsCommandContext { account_id: None }).await?;
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
            created_at: bucket
                .creation_date()
                .map(|created_at| created_at.to_string()),
        })
        .collect())
}

#[tauri::command]
pub async fn list_s3_objects(
    app: AppHandle,
    request: S3ListObjectsRequest,
) -> AppResult<Vec<S3ObjectEntry>> {
    if request.bucket.trim().is_empty() {
        return Err(AppError::validation("Bucket is required."));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
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
pub async fn list_s3_job_log_objects(
    app: AppHandle,
    request: S3JobLogObjectsRequest,
) -> AppResult<S3JobLogObjectsResponse> {
    if request.bucket.trim().is_empty() || request.prefix.trim().is_empty() {
        return Err(AppError::validation(
            "Bucket and job log prefix are required to list S3 job logs.",
        ));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    let mut operation = client
        .list_objects_v2()
        .bucket(&request.bucket)
        .prefix(&request.prefix);
    if let Some(token) = request.continuation_token.clone() {
        operation = operation.continuation_token(token);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;
    let job_id = job_id_from_prefix(&request.prefix).unwrap_or_default();
    let objects = response
        .contents()
        .iter()
        .filter_map(|object_summary| {
            let key = object_summary.key()?;
            parse_s3_job_log_object(
                key,
                &job_id,
                object_summary.size().unwrap_or_default(),
                object_summary.last_modified().map(|date| date.to_string()),
            )
        })
        .collect();

    Ok(S3JobLogObjectsResponse {
        bucket: request.bucket,
        objects,
        next_token: response.next_continuation_token().map(ToString::to_string),
    })
}

#[tauri::command]
pub async fn get_s3_job_log_object(
    app: AppHandle,
    request: S3ObjectRequest,
) -> AppResult<S3TextObject> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
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
    let content = decode_s3_log_content(&request.key, bytes.as_ref())?;

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
pub async fn get_s3_text_object(
    app: AppHandle,
    request: S3ObjectRequest,
) -> AppResult<S3TextObject> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
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
            editability
                .reason
                .unwrap_or_else(|| "Object cannot be previewed.".to_string()),
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
pub async fn put_s3_text_object(app: AppHandle, request: S3TextObject) -> AppResult<S3TextObject> {
    let editability = s3_object_editability(&request.key, request.content.len() as u64);
    if !editability.editable {
        return Err(AppError::validation(
            editability
                .reason
                .unwrap_or_else(|| "Object cannot be edited.".to_string()),
        ));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
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
pub async fn upload_s3_object(app: AppHandle, request: S3TextObject) -> AppResult<S3ObjectEntry> {
    let saved = put_s3_text_object(app, request).await?;
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
pub async fn download_s3_object(
    app: AppHandle,
    request: S3ObjectRequest,
) -> AppResult<S3TextObject> {
    get_s3_text_object(app, request).await
}

#[tauri::command]
pub async fn download_s3_object_to_disk(
    app: AppHandle,
    request: S3ObjectRequest,
) -> AppResult<Option<String>> {
    if request.bucket.trim().is_empty() || request.key.trim().is_empty() {
        return Err(AppError::validation("Bucket and key are required."));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    let response = client
        .get_object()
        .bucket(&request.bucket)
        .key(&request.key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;
    let bytes = response
        .body
        .collect()
        .await
        .map_err(|error| AppError::aws("s3", error))?
        .into_bytes();
    let suggested_name = request
        .key
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("s3-object")
        .to_string();
    let path = rfd::AsyncFileDialog::new()
        .set_file_name(&suggested_name)
        .save_file()
        .await;

    let Some(path) = path else {
        return Ok(None);
    };

    tokio::fs::write(path.path(), bytes)
        .await
        .map_err(|error| AppError::storage(format!("Failed to save S3 object: {error}")))?;

    Ok(Some(
        path.path()
            .to_string_lossy()
            .into_owned(),
    ))
}

#[tauri::command]
pub async fn upload_s3_object_from_disk(
    app: AppHandle,
    request: S3UploadFromDiskRequest,
) -> AppResult<Option<S3ObjectEntry>> {
    if request.bucket.trim().is_empty() {
        return Err(AppError::validation("Bucket is required."));
    }

    let file = rfd::AsyncFileDialog::new().pick_file().await;
    let Some(file) = file else {
        return Ok(None);
    };

    let path = file.path();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::validation("Selected file has no name."))?;
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| AppError::storage(format!("Failed to read selected file: {error}")))?;
    let prefix = request.prefix.clone().unwrap_or_default();
    let key = format!("{prefix}{file_name}");

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    let response = client
        .put_object()
        .bucket(&request.bucket)
        .key(&key)
        .body(ByteStream::from(bytes.clone()))
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;

    Ok(Some(object(
        &request.bucket,
        key,
        bytes.len() as i64,
        "file",
        Some(Utc::now().to_rfc3339()),
        response.e_tag().map(ToString::to_string),
    )))
}

#[tauri::command]
pub async fn rename_s3_object(
    app: AppHandle,
    request: S3RenameObjectRequest,
) -> AppResult<S3ObjectEntry> {
    if request.bucket.trim().is_empty()
        || request.source_key.trim().is_empty()
        || request.destination_key.trim().is_empty()
    {
        return Err(AppError::validation("Bucket, source key, and destination key are required."));
    }
    if request.source_key == request.destination_key {
        return Err(AppError::validation("Source and destination keys must differ."));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_s3::Client::new(&runtime.config);
    let copy_source = format!(
        "{}/{}",
        request.bucket,
        percent_encode_path(&request.source_key)
    );
    let copied = client
        .copy_object()
        .bucket(&request.bucket)
        .key(&request.destination_key)
        .copy_source(copy_source)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id.clone(), error))?;
    client
        .delete_object()
        .bucket(&request.bucket)
        .key(&request.source_key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("s3", runtime.account.id, error))?;

    Ok(object(
        &request.bucket,
        request.destination_key,
        0,
        "file",
        Some(Utc::now().to_rfc3339()),
        copied.copy_object_result().and_then(|result| result.e_tag()).map(ToString::to_string),
    ))
}

#[tauri::command]
pub async fn delete_s3_object(app: AppHandle, request: S3ObjectRequest) -> AppResult<()> {
    if request.bucket.trim().is_empty() || request.key.trim().is_empty() {
        return Err(AppError::validation("Bucket and key are required."));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
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

fn percent_encode_path(key: &str) -> String {
    key.split('/')
        .map(urlencoding::encode)
        .map(|segment| segment.into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn object(
    bucket: &str,
    key: String,
    size: i64,
    kind: &str,
    last_modified: Option<String>,
    etag: Option<String>,
) -> S3ObjectEntry {
    S3ObjectEntry {
        bucket: bucket.to_string(),
        key,
        kind: kind.to_string(),
        size,
        last_modified,
        etag,
    }
}

fn decode_s3_log_content(key: &str, bytes: &[u8]) -> AppResult<String> {
    let decoded = if key.ends_with(".gz") {
        let mut decoder = GzDecoder::new(bytes);
        let mut content = String::new();
        decoder
            .read_to_string(&mut content)
            .map_err(|_| AppError::validation("Gzip log object is not valid UTF-8 text."))?;
        content
    } else {
        String::from_utf8(bytes.to_vec())
            .map_err(|_| AppError::validation("Log object is not valid UTF-8 text."))?
    };

    Ok(decoded)
}

fn parse_s3_job_log_object(
    key: &str,
    job_id: &str,
    size: i64,
    last_modified: Option<String>,
) -> Option<S3JobLogObject> {
    let normalized_key = key.strip_suffix(".gz").unwrap_or(key);
    let parsed = parse_emr_log_path(normalized_key, job_id)?;
    let label = format!("{} {}", parsed.pod, parsed.stream);
    Some(S3JobLogObject {
        source: "s3".to_string(),
        id: key.to_string(),
        label,
        r#type: parsed.log_type,
        container: parsed.container,
        pod: parsed.pod,
        stream: parsed.stream,
        s3_key: key.to_string(),
        size,
        last_modified,
    })
}

struct ParsedLogPath {
    log_type: String,
    container: String,
    pod: String,
    stream: String,
}

fn parse_emr_log_path(path: &str, job_id: &str) -> Option<ParsedLogPath> {
    let parts = path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let containers_index = parts
        .windows(3)
        .position(|window| window[0] == "jobs" && window[1] == job_id && window[2] == "containers")
        .map(|index| index + 2)?;
    let after_containers = &parts[(containers_index + 1)..];
    if after_containers.len() < 2 {
        return None;
    }

    let stream = after_containers.last()?.to_string();
    let pod = after_containers
        .get(after_containers.len() - 2)?
        .to_string();
    let container = if after_containers.len() > 2 {
        after_containers[..after_containers.len() - 2].join("/")
    } else {
        pod.clone()
    };

    Some(ParsedLogPath {
        log_type: classify_pod(&pod, job_id),
        container,
        pod,
        stream,
    })
}

fn classify_pod(pod: &str, job_id: &str) -> String {
    let lower = pod.to_lowercase();
    if lower.contains("driver") {
        "driver".to_string()
    } else if lower.contains("exec") {
        "executor".to_string()
    } else if lower.contains(&format!("spark-{}", job_id).to_lowercase()) {
        "driver".to_string()
    } else {
        "controller".to_string()
    }
}

fn job_id_from_prefix(prefix: &str) -> Option<String> {
    let parts = prefix
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    parts
        .windows(2)
        .find_map(|window| (window[0] == "jobs").then(|| window[1].to_string()))
}

#[cfg(test)]
mod tests {
    use super::decode_s3_log_content;

    #[test]
    fn decodes_gzip_s3_log_archives_as_text() {
        let gzip_bytes = [
            31, 139, 8, 0, 0, 0, 0, 0, 2, 255, 203, 72, 205, 201, 201, 87, 200, 201, 79, 231, 2, 0,
            47, 57, 109, 60, 10, 0, 0, 0,
        ];

        let content =
            decode_s3_log_content("logs/vc/jobs/job/containers/driver/stderr.gz", &gzip_bytes)
                .expect("gzip log decodes");

        assert_eq!(content, "hello log\n");
    }
}
