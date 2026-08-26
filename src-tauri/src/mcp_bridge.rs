use crate::aws::runtime::runtime_for_context;
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, AwsAccountSummary, JobLogStream, JobLogStreamsResponse, JobLogsResponse,
    LogEntry, S3JobLogObjectsResponse, S3TextObject,
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::{TimeZone, Utc};
use serde::Deserialize;
use std::sync::Arc;
use tokio::net::TcpListener;
use tauri::AppHandle;

fn aws_datetime_to_rfc3339(dt: &aws_smithy_types::DateTime) -> Option<String> {
    let secs = dt.secs();
    let millis = secs * 1000 + i64::from(dt.subsec_nanos()) / 1_000_000;
    Utc.timestamp_millis_opt(millis).single().map(|t| t.to_rfc3339())
}

struct BridgeInner {
    app: AppHandle,
    token: String,
}

pub struct BridgeServer {
    port: u16,
    token: String,
    task: tokio::task::JoinHandle<()>,
}

impl BridgeServer {
    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn into_task(self) -> tokio::task::JoinHandle<()> {
        self.task
    }
}

#[derive(Clone)]
struct BridgeState {
    inner: Arc<BridgeInner>,
}

#[derive(Deserialize)]
struct DescribeJobReq {
    account_id: Option<String>,
    job_id: String,
    virtual_cluster_id: Option<String>,
}

#[derive(Deserialize)]
struct ListLogStreamsReq {
    account_id: Option<String>,
    job_id: String,
    log_group_name: String,
    stream_name_prefix: String,
    next_token: Option<String>,
}

#[derive(Deserialize)]
struct GetLogsReq {
    account_id: Option<String>,
    job_id: String,
    log_group_name: Option<String>,
    stream_name_prefix: Option<String>,
    log_stream_name: Option<String>,
    filter_pattern: Option<String>,
    limit: Option<i32>,
    next_forward_token: Option<String>,
}

#[derive(Deserialize)]
struct ListS3ObjectsReq {
    account_id: Option<String>,
    bucket: String,
    prefix: String,
    continuation_token: Option<String>,
}

#[derive(Deserialize)]
struct GetS3ObjectReq {
    account_id: Option<String>,
    bucket: String,
    key: String,
}

/// Account shape exposed to the MCP server (and therefore to the LLM).
/// Deliberately omits access keys, the AWS account number, and the full
/// identity ARN — only a human-readable username is exposed so the model can
/// tell accounts apart.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeAccount {
    id: String,
    name: String,
    region: String,
    is_active: bool,
    username: String,
}

impl From<AwsAccountSummary> for BridgeAccount {
    fn from(a: AwsAccountSummary) -> Self {
        let username = a
            .identity
            .as_ref()
            .and_then(|i| i.arn.rsplit('/').next())
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| a.name.clone());

        Self {
            id: a.id,
            name: a.name,
            region: a.region,
            is_active: a.is_active,
            username,
        }
    }
}

pub async fn start(app: AppHandle, token: String) -> AppResult<BridgeServer> {
    let inner = Arc::new(BridgeInner {
        app,
        token: token.clone(),
    });

    let state = BridgeState { inner: inner.clone() };

    let router = Router::new()
        .route("/health", get(health))
        .route("/list-accounts", post(list_accounts))
        .route("/describe-job", post(describe_job))
        .route("/list-log-streams", post(list_log_streams))
        .route("/get-logs", post(get_logs))
        .route("/list-s3-objects", post(list_s3_objects))
        .route("/get-s3-object", post(get_s3_object))
        .with_state(state);

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let task = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("MCP bridge error: {e}");
        }
    });

    Ok(BridgeServer { port, token, task })
}

async fn health(
    headers: HeaderMap,
    State(state): State<BridgeState>,
) -> impl axum::response::IntoResponse {
    let _ = auth_check(&state, &headers).await;
    Json(serde_json::json!({"status": "ok"}))
}

async fn list_accounts(
    headers: HeaderMap,
    State(state): State<BridgeState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    auth_check(&state, &headers).await?;
    let result = do_list_accounts().await;
    to_json(result)
}

async fn describe_job(
    headers: HeaderMap,
    State(state): State<BridgeState>,
    Json(body): Json<DescribeJobReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    auth_check(&state, &headers).await?;

    // Delegate to the same command the desktop UI uses. It resolves the job
    // via AWS when a virtual cluster id is given, and otherwise falls back to
    // the app's local job history — so the MCP caller only needs the job id.
    let result = crate::commands::emr::describe_job_run(
        state.inner.app.clone(),
        crate::models::JobRunRequest {
            account_id: body.account_id,
            id: Some(body.job_id),
            virtual_cluster_id: body.virtual_cluster_id,
            keyword: None,
            next_token: None,
            max_results: None,
            created_after_days: None,
        },
    )
    .await;

    to_json(result)
}

async fn list_log_streams(
    headers: HeaderMap,
    State(state): State<BridgeState>,
    Json(body): Json<ListLogStreamsReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    auth_check(&state, &headers).await?;

    let r: AppResult<JobLogStreamsResponse> = async {
        let runtime = runtime_for_context(
            &state.inner.app,
            AwsCommandContext { account_id: body.account_id.clone() },
        )
        .await?;
        let client = aws_sdk_cloudwatchlogs::Client::new(&runtime.config);
        let mut op = client
            .describe_log_streams()
            .log_group_name(&body.log_group_name)
            .log_stream_name_prefix(&body.stream_name_prefix)
            .order_by(aws_sdk_cloudwatchlogs::types::OrderBy::LogStreamName);
        if let Some(t) = &body.next_token {
            op = op.next_token(t);
        }
        let resp = op.send().await.map_err(|e| AppError::aws_sdk("cloudwatchlogs", e))?;

        let streams: Vec<JobLogStream> = resp
            .log_streams()
            .iter()
            .filter_map(|s| {
                let name = s.log_stream_name()?;
                Some(JobLogStream {
                    source: "cloudwatch".to_string(),
                    id: name.to_string(),
                    label: name.to_string(),
                    r#type: "logStream".to_string(),
                    container: String::new(),
                    pod: String::new(),
                    stream: String::new(),
                    cloud_watch_stream_name: name.to_string(),
                    last_event_timestamp: s
                        .last_event_timestamp()
                        .and_then(|ms| Utc.timestamp_millis_opt(ms).single())
                        .map(|t| t.to_rfc3339()),
                })
            })
            .collect();

        Ok(JobLogStreamsResponse {
            job_id: body.job_id,
            streams,
            next_token: resp.next_token().map(String::from),
        })
    }.await;

    to_json(r)
}

async fn get_logs(
    headers: HeaderMap,
    State(state): State<BridgeState>,
    Json(body): Json<GetLogsReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    auth_check(&state, &headers).await?;

    let r: AppResult<JobLogsResponse> = async {
        let runtime = runtime_for_context(
            &state.inner.app,
            AwsCommandContext { account_id: body.account_id.clone() },
        )
        .await?;
        let client = aws_sdk_cloudwatchlogs::Client::new(&runtime.config);

        let log_group = body
            .log_group_name
            .clone()
            .unwrap_or_else(|| format!("/aws/emr-containers/jobs/{}", body.job_id));

        let mut op = client
            .filter_log_events()
            .log_group_name(&log_group)
            .limit(body.limit.unwrap_or(500));

        if let Some(s) = &body.log_stream_name {
            op = op.log_stream_names(s);
        }
        if let Some(p) = &body.stream_name_prefix {
            op = op.log_stream_name_prefix(p);
        }
        if let Some(t) = &body.next_forward_token {
            op = op.next_token(t);
        }
        if let Some(p) = &body.filter_pattern {
            op = op.filter_pattern(p);
        }

        let resp = op.send().await.map_err(|e| AppError::aws_sdk("cloudwatchlogs", e))?;

        let entries: Vec<LogEntry> = resp
            .events()
            .iter()
            .filter_map(|e| {
                let msg = e.message()?;
                let ts = e.timestamp().and_then(|ms| Utc.timestamp_millis_opt(ms).single());
                let stream = e.log_stream_name().unwrap_or_default();
                let (level, message) = normalize_message(msg);
                Some(LogEntry {
                    timestamp: ts.map(|t| t.to_rfc3339()).unwrap_or_default(),
                    level,
                    message,
                    stream_name: stream.to_string(),
                })
            })
            .collect();

        Ok(JobLogsResponse {
            job_id: body.job_id,
            entries,
            next_forward_token: resp.next_token().map(String::from),
        })
    }.await;

    to_json(r)
}

async fn list_s3_objects(
    headers: HeaderMap,
    State(state): State<BridgeState>,
    Json(body): Json<ListS3ObjectsReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    auth_check(&state, &headers).await?;

    let r: AppResult<S3JobLogObjectsResponse> = async {
        let runtime = runtime_for_context(
            &state.inner.app,
            AwsCommandContext { account_id: body.account_id.clone() },
        )
        .await?;
        let client = aws_sdk_s3::Client::new(&runtime.config);

        let mut op = client
            .list_objects_v2()
            .bucket(&body.bucket)
            .prefix(&body.prefix);
        if let Some(t) = &body.continuation_token {
            op = op.continuation_token(t);
        }
        let resp = op.send().await.map_err(|e| AppError::aws_sdk("s3", e))?;

        let mut objects = Vec::new();
        for obj in resp.contents().iter() {
            let key = obj.key().unwrap_or_default();
            if key.is_empty() || key.ends_with('/') {
                continue;
            }
            if let Some(size) = obj.size() {
                if size == 0 {
                    continue;
                }
            }
            let stream = key.split('/').last().unwrap_or(key).to_string();
            objects.push(crate::models::S3JobLogObject {
                source: "s3".to_string(),
                id: key.to_string(),
                label: stream.clone(),
                r#type: "sparkLog".to_string(),
                container: String::new(),
                pod: String::new(),
                stream,
                s3_key: key.to_string(),
                size: obj.size().unwrap_or(0),
                last_modified: obj.last_modified().and_then(aws_datetime_to_rfc3339),
            });
        }

        Ok(S3JobLogObjectsResponse {
            bucket: body.bucket,
            objects,
            next_token: resp.next_continuation_token().map(String::from),
        })
    }.await;

    to_json(r)
}

async fn get_s3_object(
    headers: HeaderMap,
    State(state): State<BridgeState>,
    Json(body): Json<GetS3ObjectReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    auth_check(&state, &headers).await?;

    let r: AppResult<S3TextObject> = async {
        let runtime = runtime_for_context(
            &state.inner.app,
            AwsCommandContext { account_id: body.account_id.clone() },
        )
        .await?;
        let client = aws_sdk_s3::Client::new(&runtime.config);

        let resp = client
            .get_object()
            .bucket(&body.bucket)
            .key(&body.key)
            .send()
            .await
            .map_err(|e| AppError::aws_sdk("s3", e))?;

        let etag = resp.e_tag().map(ToString::to_string);
        let content_type = resp.content_type().map(ToString::to_string);
        let last_modified = resp.last_modified().map(|t| t.to_string());
        let body_bytes = resp.body.collect().await.map_err(|e| {
            AppError::internal(format!("Failed to read S3 object: {e}"))
        })?.into_bytes();
        let content = String::from_utf8_lossy(body_bytes.as_ref()).to_string();

        Ok(S3TextObject {
            account_id: body.account_id,
            bucket: body.bucket,
            key: body.key,
            content,
            etag,
            content_type,
            last_modified,
        })
    }.await;

    to_json(r)
}

async fn do_list_accounts() -> AppResult<Vec<BridgeAccount>> {
    let pool = repository::pool().await?;
    Ok(repository::list_aws_accounts(&pool)
        .await?
        .into_iter()
        .map(AwsAccountSummary::from)
        .map(BridgeAccount::from)
        .collect())
}

async fn auth_check(
    state: &BridgeState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let token = headers
        .get("x-mcp-bridge-token")
        .and_then(|v| v.to_str().ok())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
        })
        .unwrap_or_default();

    if token.is_empty() || token != state.inner.token {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Invalid bridge token"})),
        ));
    }
    Ok(())
}

fn to_json<T: serde::Serialize>(
    result: AppResult<T>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match result {
        Ok(v) => match serde_json::to_value(v) {
            Ok(j) => Ok(Json(serde_json::json!({"data": j}))),
            Err(e) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Serialization error: {e}")})),
            )),
        },
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.message})),
        )),
    }
}

fn normalize_message(msg: &str) -> (String, String) {
    let trimmed = msg.trim();
    if trimmed.is_empty() {
        return ("info".to_string(), String::new());
    }
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return normalize_json_value(&parsed);
    }
    (infer_level(trimmed), trimmed.to_string())
}

fn normalize_json_value(v: &serde_json::Value) -> (String, String) {
    if let Some(s) = v.as_str() {
        if let Ok(nested) = serde_json::from_str::<serde_json::Value>(s) {
            return normalize_json_value(&nested);
        }
        return (infer_level(s), s.to_string());
    }
    if let Some(obj) = v.as_object() {
        let level = obj
            .get("level")
            .or_else(|| obj.get("severity"))
            .or_else(|| obj.get("logLevel"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let message = obj
            .get("message")
            .or_else(|| obj.get("msg"))
            .or_else(|| obj.get("log"))
            .or_else(|| obj.get("@message"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !message.is_empty() {
            let lvl = if level.is_empty() { infer_level(&message) } else { level.to_lowercase() };
            return (lvl, message);
        }
        if !level.is_empty() {
            return (level.to_lowercase(), serde_json::to_string(v).unwrap_or_default());
        }
    }
    ("info".to_string(), serde_json::to_string(v).unwrap_or_default())
}

fn infer_level(msg: &str) -> String {
    let lower = msg.to_lowercase();
    if lower.contains("error") || lower.contains("exception") || lower.contains("fatal") {
        return "error".to_string();
    }
    if lower.contains("warn") {
        return "warn".to_string();
    }
    if lower.contains("debug") {
        return "debug".to_string();
    }
    "info".to_string()
}

