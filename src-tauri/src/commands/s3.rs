use crate::aws::runtime::runtime_for_context;
use crate::aws::s3_client;
use crate::aws::s3_rules::s3_object_editability;
use crate::emr_log_path::{job_id_from_prefix, parse_emr_log_path};
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, S3Bucket, S3CreateFolderRequest, S3JobLogObject, S3JobLogObjectsRequest,
    S3JobLogObjectsResponse, S3ListObjectsRequest, S3ObjectEntry, S3ObjectExistsRequest,
    S3ObjectRequest, S3PrefixDeletionSummary, S3RenameObjectRequest, S3TextObject,
    S3UploadFromDiskRequest, S3UploadFromPathRequest, S3UploadPrepareResult,
};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart, Delete, ObjectIdentifier};
use chrono::Utc;
use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::HashSet;
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::AsyncReadExt;

const S3_UPLOAD_PROGRESS_EVENT: &str = "s3:upload-progress";
/// Use multipart upload once the file is larger than this threshold.
const MULTIPART_THRESHOLD_BYTES: u64 = 8 * 1024 * 1024;
/// Multipart part size (must be >= 5 MiB except for the final part).
const MULTIPART_PART_SIZE: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct S3UploadProgressEvent {
    file_name: String,
    key: String,
    phase: String,
    bytes_uploaded: u64,
    total_bytes: u64,
    percent: u8,
}

#[tauri::command]
pub async fn list_s3_buckets(
    app: AppHandle,
    request: AwsCommandContext,
) -> AppResult<Vec<S3Bucket>> {
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id,
        },
    )
    .await?;
    let client = s3_client::default_client(&runtime);
    let response =
        client.list_buckets().send().await.map_err(|error| {
            AppError::aws_for_account_sdk("s3", runtime.account.id.clone(), error)
        })?;

    Ok(response
        .buckets()
        .iter()
        .map(|bucket| {
            let name = bucket.name().unwrap_or_default().to_string();
            if let Some(region) = bucket.bucket_region() {
                s3_client::remember_bucket_region(&runtime.account.id, &name, region);
            }
            S3Bucket {
                name,
                created_at: bucket
                    .creation_date()
                    .map(|created_at| created_at.to_string()),
                region: bucket.bucket_region().map(str::to_string),
            }
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
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
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
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;
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
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
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
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;
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
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    let response = client
        .get_object()
        .bucket(&request.bucket)
        .key(&request.key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;
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
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    let response = client
        .get_object()
        .bucket(&request.bucket)
        .key(&request.key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;
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
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
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
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;

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
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    let response = client
        .get_object()
        .bucket(&request.bucket)
        .key(&request.key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;
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

    Ok(Some(path.path().to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn prepare_s3_upload_from_disk(
    app: AppHandle,
    request: S3UploadFromDiskRequest,
) -> AppResult<Option<S3UploadPrepareResult>> {
    if request.bucket.trim().is_empty() {
        return Err(AppError::validation("Bucket is required."));
    }

    let file = rfd::AsyncFileDialog::new().pick_file().await;
    let Some(file) = file else {
        return Ok(None);
    };

    let path = file.path().to_path_buf();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::validation("Selected file has no name."))?
        .to_string();
    let metadata = tokio::fs::metadata(&path).await.map_err(|error| {
        AppError::storage(format!("Failed to read selected file metadata: {error}"))
    })?;
    let total_bytes = metadata.len();
    let prefix = request.prefix.clone().unwrap_or_default();
    let key = format!("{prefix}{file_name}");

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let account_id = runtime.account.id.clone();
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    let exists = s3_object_exists_on_client(&client, &request.bucket, &key, &account_id).await?;
    let suggested_file_name = if exists {
        Some(
            suggest_unique_file_name(&client, &request.bucket, &prefix, &file_name, &account_id)
                .await?,
        )
    } else {
        None
    };

    Ok(Some(S3UploadPrepareResult {
        local_path: path.to_string_lossy().into_owned(),
        file_name,
        key,
        bucket: request.bucket,
        total_bytes,
        exists,
        suggested_file_name,
    }))
}

#[tauri::command]
pub async fn upload_s3_object_from_path(
    app: AppHandle,
    request: S3UploadFromPathRequest,
) -> AppResult<S3ObjectEntry> {
    if request.bucket.trim().is_empty() || request.key.trim().is_empty() {
        return Err(AppError::validation("Bucket and key are required."));
    }
    if request.local_path.trim().is_empty() {
        return Err(AppError::validation("Local path is required."));
    }
    if request.key.contains("//") || request.key.ends_with('/') {
        return Err(AppError::validation(
            "Upload key must be a file object, not a folder.",
        ));
    }

    let path = Path::new(&request.local_path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .or_else(|| request.key.rsplit('/').next())
        .ok_or_else(|| AppError::validation("Upload target has no file name."))?
        .to_string();
    let metadata = tokio::fs::metadata(path).await.map_err(|error| {
        AppError::storage(format!("Failed to read selected file metadata: {error}"))
    })?;
    let total_bytes = metadata.len();
    let key = request.key.clone();

    emit_upload_progress(&app, &file_name, &key, "preparing", 0, total_bytes);

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let account_id = runtime.account.id.clone();
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;

    let uploaded = if total_bytes > MULTIPART_THRESHOLD_BYTES {
        upload_file_multipart(&UploadContext {
            app: &app,
            client: &client,
            account_id: &account_id,
            bucket: &request.bucket,
            key: &key,
            file_name: &file_name,
            path,
            total_bytes,
        })
        .await?
    } else {
        upload_file_single(&UploadContext {
            app: &app,
            client: &client,
            account_id: &account_id,
            bucket: &request.bucket,
            key: &key,
            file_name: &file_name,
            path,
            total_bytes,
        })
        .await?
    };

    emit_upload_progress(
        &app,
        &file_name,
        &key,
        "completed",
        total_bytes,
        total_bytes,
    );
    Ok(uploaded)
}

#[tauri::command]
pub async fn s3_object_exists(app: AppHandle, request: S3ObjectExistsRequest) -> AppResult<bool> {
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
    let account_id = runtime.account.id.clone();
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    s3_object_exists_on_client(&client, &request.bucket, &request.key, &account_id).await
}

/// Keep a thin wrapper so existing callers that still invoke the old command keep working.
#[tauri::command]
pub async fn upload_s3_object_from_disk(
    app: AppHandle,
    request: S3UploadFromDiskRequest,
) -> AppResult<Option<S3ObjectEntry>> {
    let prepared = prepare_s3_upload_from_disk(app.clone(), request.clone()).await?;
    let Some(prepared) = prepared else {
        return Ok(None);
    };
    if prepared.exists {
        return Err(AppError::validation(format!(
            "Object already exists at s3://{}/{} . Use prepare + conflict dialog to overwrite or rename.",
            prepared.bucket, prepared.key
        )));
    }
    let uploaded = upload_s3_object_from_path(
        app,
        S3UploadFromPathRequest {
            account_id: request.account_id,
            bucket: prepared.bucket,
            key: prepared.key,
            local_path: prepared.local_path,
        },
    )
    .await?;
    Ok(Some(uploaded))
}

async fn s3_object_exists_on_client(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
    account_id: &str,
) -> AppResult<bool> {
    match client.head_object().bucket(bucket).key(key).send().await {
        Ok(_) => Ok(true),
        Err(error) => {
            if error
                .as_service_error()
                .is_some_and(|service_error| service_error.is_not_found())
            {
                return Ok(false);
            }
            Err(AppError::aws_for_account_sdk(
                "s3",
                account_id.to_string(),
                error,
            ))
        }
    }
}

async fn suggest_unique_file_name(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    prefix: &str,
    file_name: &str,
    account_id: &str,
) -> AppResult<String> {
    let mut candidate = next_conflict_file_name(file_name);
    for _ in 0..1000 {
        let key = format!("{prefix}{candidate}");
        if !s3_object_exists_on_client(client, bucket, &key, account_id).await? {
            return Ok(candidate);
        }
        candidate = next_conflict_file_name(&candidate);
    }
    Err(AppError::validation(
        "Could not find an unused file name for this upload.",
    ))
}

fn next_conflict_file_name(file_name: &str) -> String {
    let (stem, extension) = split_file_name(file_name);
    let next_index = match parse_trailing_conflict_index(stem) {
        Some((base, index)) => (base.to_string(), index + 1),
        None => (stem.to_string(), 1),
    };
    if extension.is_empty() {
        format!("{} ({})", next_index.0, next_index.1)
    } else {
        format!("{} ({}).{}", next_index.0, next_index.1, extension)
    }
}

fn split_file_name(file_name: &str) -> (&str, &str) {
    match file_name.rsplit_once('.') {
        Some((stem, extension))
            if !stem.is_empty() && !extension.is_empty() && !extension.contains(' ') =>
        {
            (stem, extension)
        }
        _ => (file_name, ""),
    }
}

fn parse_trailing_conflict_index(stem: &str) -> Option<(&str, u32)> {
    let trimmed = stem.trim_end();
    let (base, rest) = trimmed.rsplit_once(" (")?;
    let index_text = rest.strip_suffix(')')?;
    let index = index_text.parse::<u32>().ok()?;
    if base.is_empty() || index == 0 {
        return None;
    }
    Some((base, index))
}

fn emit_upload_progress(
    app: &AppHandle,
    file_name: &str,
    key: &str,
    phase: &str,
    bytes_uploaded: u64,
    total_bytes: u64,
) {
    let percent = if total_bytes == 0 {
        100
    } else {
        ((bytes_uploaded.min(total_bytes) as f64 / total_bytes as f64) * 100.0).round() as u8
    };
    let _ = app.emit(
        S3_UPLOAD_PROGRESS_EVENT,
        S3UploadProgressEvent {
            file_name: file_name.to_string(),
            key: key.to_string(),
            phase: phase.to_string(),
            bytes_uploaded,
            total_bytes,
            percent: percent.min(100),
        },
    );
}

/// Shared context for one S3 file upload, passed by reference to the upload
/// helpers so they do not each take eight-plus loose arguments.
struct UploadContext<'a> {
    app: &'a AppHandle,
    client: &'a aws_sdk_s3::Client,
    account_id: &'a str,
    bucket: &'a str,
    key: &'a str,
    file_name: &'a str,
    path: &'a Path,
    total_bytes: u64,
}

async fn upload_file_single(context: &UploadContext<'_>) -> AppResult<S3ObjectEntry> {
    let UploadContext {
        app,
        client,
        account_id,
        bucket,
        key,
        file_name,
        path,
        total_bytes,
    } = *context;
    emit_upload_progress(app, file_name, key, "reading", 0, total_bytes);
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| AppError::storage(format!("Failed to read selected file: {error}")))?;
    emit_upload_progress(app, file_name, key, "uploading", 0, total_bytes);

    let response = client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(ByteStream::from(bytes.clone()))
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", account_id.to_string(), error))?;

    emit_upload_progress(app, file_name, key, "uploading", total_bytes, total_bytes);
    Ok(object(
        bucket,
        key.to_string(),
        bytes.len() as i64,
        "file",
        Some(Utc::now().to_rfc3339()),
        response.e_tag().map(ToString::to_string),
    ))
}

async fn upload_file_multipart(context: &UploadContext<'_>) -> AppResult<S3ObjectEntry> {
    let UploadContext {
        app,
        client,
        account_id,
        bucket,
        key,
        file_name,
        total_bytes,
        ..
    } = *context;
    emit_upload_progress(app, file_name, key, "uploading", 0, total_bytes);

    let create = client
        .create_multipart_upload()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", account_id.to_string(), error))?;
    let upload_id = create
        .upload_id()
        .ok_or_else(|| AppError::validation("S3 did not return a multipart upload id."))?
        .to_string();

    let upload_result = upload_multipart_parts(context, &upload_id).await;

    match upload_result {
        Ok(entry) => Ok(entry),
        Err(error) => {
            let _ = client
                .abort_multipart_upload()
                .bucket(bucket)
                .key(key)
                .upload_id(&upload_id)
                .send()
                .await;
            Err(error)
        }
    }
}

async fn upload_multipart_parts(
    context: &UploadContext<'_>,
    upload_id: &str,
) -> AppResult<S3ObjectEntry> {
    let UploadContext {
        app,
        client,
        account_id,
        bucket,
        key,
        file_name,
        path,
        total_bytes,
    } = *context;
    let mut file = File::open(path)
        .await
        .map_err(|error| AppError::storage(format!("Failed to open selected file: {error}")))?;
    let mut buffer = vec![0_u8; MULTIPART_PART_SIZE];
    let mut part_number: i32 = 1;
    let mut bytes_uploaded: u64 = 0;
    let mut completed_parts: Vec<CompletedPart> = Vec::new();

    loop {
        let mut filled = 0;
        while filled < MULTIPART_PART_SIZE {
            let read = file.read(&mut buffer[filled..]).await.map_err(|error| {
                AppError::storage(format!("Failed to read selected file: {error}"))
            })?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        if filled == 0 {
            break;
        }

        let body = ByteStream::from(buffer[..filled].to_vec());
        let part = client
            .upload_part()
            .bucket(bucket)
            .key(key)
            .upload_id(upload_id)
            .part_number(part_number)
            .body(body)
            .send()
            .await
            .map_err(|error| AppError::aws_for_account_sdk("s3", account_id.to_string(), error))?;
        let etag = part
            .e_tag()
            .ok_or_else(|| {
                AppError::validation(format!("S3 part {part_number} did not return an ETag."))
            })?
            .to_string();
        completed_parts.push(
            CompletedPart::builder()
                .e_tag(etag)
                .part_number(part_number)
                .build(),
        );

        bytes_uploaded = (bytes_uploaded + filled as u64).min(total_bytes);
        emit_upload_progress(
            app,
            file_name,
            key,
            "uploading",
            bytes_uploaded,
            total_bytes,
        );
        part_number += 1;
    }

    if completed_parts.is_empty() {
        // Empty file — fall back to a simple put.
        let response = client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(ByteStream::from_static(b""))
            .send()
            .await
            .map_err(|error| AppError::aws_for_account_sdk("s3", account_id.to_string(), error))?;
        let _ = client
            .abort_multipart_upload()
            .bucket(bucket)
            .key(key)
            .upload_id(upload_id)
            .send()
            .await;
        return Ok(object(
            bucket,
            key.to_string(),
            0,
            "file",
            Some(Utc::now().to_rfc3339()),
            response.e_tag().map(ToString::to_string),
        ));
    }

    emit_upload_progress(
        app,
        file_name,
        key,
        "completing",
        bytes_uploaded,
        total_bytes,
    );
    let completed = CompletedMultipartUpload::builder()
        .set_parts(Some(completed_parts))
        .build();
    let response = client
        .complete_multipart_upload()
        .bucket(bucket)
        .key(key)
        .upload_id(upload_id)
        .multipart_upload(completed)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", account_id.to_string(), error))?;

    Ok(object(
        bucket,
        key.to_string(),
        total_bytes as i64,
        "file",
        Some(Utc::now().to_rfc3339()),
        response.e_tag().map(ToString::to_string),
    ))
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
        return Err(AppError::validation(
            "Bucket, source key, and destination key are required.",
        ));
    }
    if request.source_key == request.destination_key {
        return Err(AppError::validation(
            "Source and destination keys must differ.",
        ));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    let source = client
        .get_object()
        .bucket(&request.bucket)
        .key(&request.source_key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id.clone(), error))?;
    let content_type = source.content_type().map(ToString::to_string);
    let bytes = source
        .body
        .collect()
        .await
        .map_err(|error| AppError::aws("s3", error))?
        .into_bytes();
    let mut put_operation = client
        .put_object()
        .bucket(&request.bucket)
        .key(&request.destination_key)
        .body(ByteStream::from(bytes));
    if let Some(content_type) = content_type {
        put_operation = put_operation.content_type(content_type);
    }
    let put_response = put_operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id.clone(), error))?;
    client
        .delete_object()
        .bucket(&request.bucket)
        .key(&request.source_key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;

    Ok(object(
        &request.bucket,
        request.destination_key,
        0,
        "file",
        Some(Utc::now().to_rfc3339()),
        put_response.e_tag().map(ToString::to_string),
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
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    client
        .delete_object()
        .bucket(&request.bucket)
        .key(&request.key)
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;
    Ok(())
}

const S3_PREFIX_SCAN_LIMIT: usize = 10_000;

#[tauri::command]
pub async fn create_s3_folder(
    app: AppHandle,
    request: S3CreateFolderRequest,
) -> AppResult<S3ObjectEntry> {
    if request.bucket.trim().is_empty() {
        return Err(AppError::validation("Bucket is required."));
    }

    let folder_name = request.folder_name.trim();
    if folder_name.is_empty() {
        return Err(AppError::validation("Folder name is required."));
    }
    if folder_name.contains('/') {
        return Err(AppError::validation("Folder name cannot contain '/'."));
    }

    let parent_prefix = normalize_s3_prefix(request.parent_prefix.as_deref().unwrap_or_default());
    let folder_key = format!("{parent_prefix}{folder_name}/");

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;

    if prefix_exists(&client, &request.bucket, &parent_prefix, folder_name).await? {
        return Err(AppError::validation(format!(
            "Folder '{folder_name}/' already exists."
        )));
    }

    client
        .put_object()
        .bucket(&request.bucket)
        .key(&folder_key)
        .body(ByteStream::from_static(b""))
        .send()
        .await
        .map_err(|error| AppError::aws_for_account_sdk("s3", runtime.account.id, error))?;

    Ok(object(
        &request.bucket,
        folder_key,
        0,
        "folder",
        Some(Utc::now().to_rfc3339()),
        None,
    ))
}

#[tauri::command]
pub async fn describe_s3_prefix_deletion(
    app: AppHandle,
    request: S3ObjectRequest,
) -> AppResult<S3PrefixDeletionSummary> {
    if request.bucket.trim().is_empty() || request.key.trim().is_empty() {
        return Err(AppError::validation("Bucket and prefix are required."));
    }

    let prefix = normalize_s3_prefix(&request.key);
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    let listed =
        list_all_object_keys(&client, &request.bucket, &prefix, S3_PREFIX_SCAN_LIMIT).await?;

    Ok(build_prefix_deletion_summary(&prefix, listed))
}

#[tauri::command]
pub async fn delete_s3_prefix(app: AppHandle, request: S3ObjectRequest) -> AppResult<()> {
    if request.bucket.trim().is_empty() || request.key.trim().is_empty() {
        return Err(AppError::validation("Bucket and prefix are required."));
    }

    let prefix = normalize_s3_prefix(&request.key);
    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = s3_client::client_for_bucket(&runtime, &request.bucket).await?;
    let listed = list_all_object_keys(&client, &request.bucket, &prefix, usize::MAX).await?;

    for chunk in listed.keys.chunks(1000) {
        let objects = chunk
            .iter()
            .map(|key| ObjectIdentifier::builder().key(key).build())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::validation(error.to_string()))?;
        client
            .delete_objects()
            .bucket(&request.bucket)
            .delete(
                Delete::builder()
                    .set_objects(Some(objects))
                    .build()
                    .map_err(|error| AppError::validation(error.to_string()))?,
            )
            .send()
            .await
            .map_err(|error| {
                AppError::aws_for_account_sdk("s3", runtime.account.id.clone(), error)
            })?;
    }

    Ok(())
}

async fn prefix_exists(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    parent_prefix: &str,
    folder_name: &str,
) -> AppResult<bool> {
    let folder_key = format!("{parent_prefix}{folder_name}/");
    let response = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(&folder_key)
        .max_keys(1)
        .send()
        .await
        .map_err(|error| AppError::aws("s3", error))?;

    if !response.contents().is_empty() {
        return Ok(true);
    }

    let delimiter_response = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(parent_prefix)
        .delimiter("/")
        .send()
        .await
        .map_err(|error| AppError::aws("s3", error))?;

    Ok(delimiter_response
        .common_prefixes()
        .iter()
        .filter_map(|entry| entry.prefix())
        .any(|entry| entry == folder_key))
}

struct ListedPrefixObjects {
    keys: Vec<String>,
    total_bytes: u64,
    truncated: bool,
}

async fn list_all_object_keys(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    prefix: &str,
    limit: usize,
) -> AppResult<ListedPrefixObjects> {
    let mut keys = Vec::new();
    let mut total_bytes = 0_u64;
    let mut continuation_token: Option<String> = None;
    let mut truncated = false;

    loop {
        let mut operation = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .max_keys(1000);
        if let Some(token) = continuation_token.clone() {
            operation = operation.continuation_token(token);
        }

        let response = operation
            .send()
            .await
            .map_err(|error| AppError::aws("s3", error))?;

        for object_summary in response.contents() {
            if keys.len() >= limit {
                truncated = true;
                break;
            }
            keys.push(object_summary.key().unwrap_or_default().to_string());
            total_bytes += object_summary.size().unwrap_or_default().max(0) as u64;
        }

        if truncated {
            break;
        }

        continuation_token = response.next_continuation_token().map(ToString::to_string);
        if continuation_token.is_none() {
            break;
        }
    }

    Ok(ListedPrefixObjects {
        keys,
        total_bytes,
        truncated,
    })
}

fn normalize_s3_prefix(prefix: &str) -> String {
    if prefix.is_empty() {
        return String::new();
    }
    if prefix.ends_with('/') {
        prefix.to_string()
    } else {
        format!("{prefix}/")
    }
}

fn build_prefix_deletion_summary(
    prefix: &str,
    listed: ListedPrefixObjects,
) -> S3PrefixDeletionSummary {
    let (file_count, folder_count) = count_prefix_children(&listed.keys, prefix);

    S3PrefixDeletionSummary {
        prefix: prefix.to_string(),
        file_count,
        folder_count,
        total_object_count: listed.keys.len() as u64,
        total_bytes: listed.total_bytes,
        truncated: listed.truncated,
    }
}

fn count_prefix_children(keys: &[String], prefix: &str) -> (u64, u64) {
    let mut file_count = 0_u64;
    let mut folder_paths = HashSet::new();

    for key in keys {
        if key.ends_with('/') {
            if key != prefix {
                folder_paths.insert(key.clone());
            }
            continue;
        }

        file_count += 1;
        let relative = key.strip_prefix(prefix).unwrap_or(key);
        let segments = relative
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();
        if segments.len() <= 1 {
            continue;
        }

        for index in 0..segments.len() - 1 {
            folder_paths.insert(format!("{}{}/", prefix, segments[..=index].join("/")));
        }
    }

    (file_count, folder_paths.len() as u64)
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

#[cfg(test)]
mod tests {
    use super::{
        count_prefix_children, decode_s3_log_content, next_conflict_file_name, normalize_s3_prefix,
        parse_s3_job_log_object,
    };

    const JOB: &str = "0000000381t77o3g8f5";
    const VC: &str = "virtual-cluster-1";

    #[test]
    fn control_log_objects_keep_their_gz_key_but_drop_the_suffix_from_the_stream() {
        let key = format!("logs/{VC}/jobs/{JOB}/control-logs/{JOB}-qs8tm/stderr.gz");
        let object = parse_s3_job_log_object(&key, JOB, 42, None).expect("control-logs object");

        assert_eq!(object.r#type, "controller");
        assert_eq!(object.stream, "stderr");
        assert_eq!(object.s3_key, key, "the .gz key must stay fetchable");
        assert_eq!(object.size, 42);
    }

    #[test]
    fn skips_job_level_files_that_are_not_pod_logs() {
        // job-metadata.log lives directly under the job prefix.
        assert!(parse_s3_job_log_object(
            &format!("logs/{VC}/jobs/{JOB}/job-metadata.log"),
            JOB,
            1,
            None
        )
        .is_none());
    }

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

    #[test]
    fn normalizes_prefixes_with_trailing_slash() {
        assert_eq!(normalize_s3_prefix("logs"), "logs/");
        assert_eq!(normalize_s3_prefix("logs/"), "logs/");
        assert_eq!(normalize_s3_prefix(""), "");
    }

    #[test]
    fn counts_nested_files_and_folders_for_deletion_summary() {
        let keys = vec![
            "logs/".to_string(),
            "logs/readme.txt".to_string(),
            "logs/app/stdout.log".to_string(),
            "logs/app/trace.log".to_string(),
        ];
        let (file_count, folder_count) = count_prefix_children(&keys, "logs/");
        assert_eq!(file_count, 3);
        assert_eq!(folder_count, 1);
    }

    #[test]
    fn suggests_conflict_file_names_with_incrementing_suffix() {
        assert_eq!(next_conflict_file_name("report.csv"), "report (1).csv");
        assert_eq!(next_conflict_file_name("report (1).csv"), "report (2).csv");
        assert_eq!(next_conflict_file_name("archive"), "archive (1)");
        assert_eq!(next_conflict_file_name("archive (9)"), "archive (10)");
    }
}
