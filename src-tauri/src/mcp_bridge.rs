use crate::aws::runtime::runtime_for_context;
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, AwsAccountSummary, JobLogStream, JobLogStreamsResponse, JobLogsResponse,
    JobRunSummary, LogEntry, S3JobLogObjectsResponse, S3TextObject,
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

#[derive(Deserialize)]
struct FindJobByIdReq {
    job_id: String,
}

/// Job found by id, across all configured accounts.
///
/// `found_in_other_account` is true when the job lives in an account that is
/// NOT the desktop app's currently-active account — the caller can surface a
/// hint ("found in another account") to the user.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FindJobByIdResp {
    job: JobRunSummary,
    account_id: String,
    account_name: String,
    region: String,
    found_in_other_account: bool,
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
        .route("/find-job-by-id", post(find_job_by_id))
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
        // EMR on EKS archives container logs gzip-compressed (.gz). Decode
        // them like the desktop S3 log viewer so the MCP tool sees text, not
        // binary. Also sniff the gzip magic bytes in case the object has no
        // .gz suffix.
        let content = decode_s3_text_object(&body.key, body_bytes.as_ref())?;

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

/// Decode an S3 object body to text, decompressing gzip when the key ends in
/// `.gz` or the content carries the gzip magic bytes — mirroring the desktop
/// app's S3 log decoding (`commands::s3::decode_s3_log_content`).
fn decode_s3_text_object(key: &str, bytes: &[u8]) -> AppResult<String> {
    let is_gzip = key.ends_with(".gz") || bytes.starts_with(&[0x1f, 0x8b]);
    if is_gzip {
        let mut decoder = flate2::read::GzDecoder::new(bytes);
        let mut content = String::new();
        std::io::Read::read_to_string(&mut decoder, &mut content)
            .map_err(|e| AppError::validation(format!("Gzip log object is not valid text: {e}")))?;
        return Ok(content);
    }
    Ok(String::from_utf8_lossy(bytes).to_string())
}

async fn find_job_by_id(
    headers: HeaderMap,
    State(state): State<BridgeState>,
    Json(body): Json<FindJobByIdReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    auth_check(&state, &headers).await?;
    let r: AppResult<FindJobByIdResp> = do_find_job_by_id(&state.inner.app, &body.job_id).await;
    to_json(r)
}

/// Locate a job by id across every configured account, active account first.
///
/// For each account (active → others), first check the app's local job-history
/// cache; if the job isn't there, enumerate that account's virtual clusters
/// (all states, so TERMINATED clusters are searched too) and call
/// `DescribeJobRun` on each. The first hit wins and is cached in job_history.
///
/// Account/credential errors are logged and skipped rather than aborting the
/// search, so one misconfigured account can't block lookup in the others.
async fn do_find_job_by_id(app: &AppHandle, job_id: &str) -> AppResult<FindJobByIdResp> {
    let pool = repository::pool().await?;
    let active = repository::active_aws_account(&pool).await?;
    let mut accounts = repository::list_aws_accounts(&pool).await?;
    // Active account first so it is always searched before the others.
    if let Some(active) = active {
        if let Some(idx) = accounts.iter().position(|a| a.id == active.id) {
            let account = accounts.remove(idx);
            accounts.insert(0, account);
        }
    }

    for account in accounts {
        // 1. Local cache first — the app may already know this job. Job ids are
        //    matched exactly; no prefix matching is allowed.
        if let Ok(history) = repository::list_job_history(&pool, Some(&account.id), None, None)
            .await
        {
            if let Some(job) = history.into_iter().find(|job| job.id == job_id) {
                return Ok(FindJobByIdResp {
                    job,
                    account_id: account.id.clone(),
                    account_name: account.name.clone(),
                    region: account.region.clone(),
                    found_in_other_account: !account.is_active,
                });
            }
        }

        // 2. Enumerate virtual clusters and probe each one via AWS.
        let runtime = match runtime_for_context(
            app,
            AwsCommandContext {
                account_id: Some(account.id.clone()),
            },
        )
        .await
        {
            Ok(runtime) => runtime,
            Err(e) => {
                crate::diagnostics::append_log_line(
                    "WARN",
                    &format!(
                        "find-job-by-id: skipping account {} ({}): {e}",
                        account.name, account.id
                    ),
                );
                continue;
            }
        };
        let client = aws_sdk_emrcontainers::Client::new(&runtime.config);
        let vc_ids = match list_virtual_cluster_ids(&client).await {
            Ok(ids) => ids,
            Err(e) => {
                crate::diagnostics::append_log_line(
                    "WARN",
                    &format!(
                        "find-job-by-id: skipping account {} ({}): {e}",
                        account.name, account.id
                    ),
                );
                continue;
            }
        };

        for vc_id in vc_ids {
            // Job ids are matched exactly on both the local cache and the AWS
            // path — prefix resolution is not allowed anywhere.
            let Ok(response) = client
                .describe_job_run()
                .id(job_id)
                .virtual_cluster_id(&vc_id)
                .send()
                .await
            else {
                continue;
            };
            let Some(job_run) = response.job_run() else {
                continue;
            };
            let mut job = crate::commands::emr::map_job_run(
                &job_run,
                Some(account.id.clone()),
                Some(account.region.clone()),
            );
            // Enrich with configuration overrides (monitoring config for S3/CW log URIs).
            if let Some(overrides) =
                job_run.configuration_overrides().and_then(
                    crate::commands::emr::map_configuration_overrides,
                )
            {
                if let Some(details) = &mut job.describe_details {
                    details.configuration_overrides = Some(overrides);
                }
            }
            repository::upsert_job_history(&pool, &job).await?;
            return Ok(FindJobByIdResp {
                job,
                account_id: account.id.clone(),
                account_name: account.name.clone(),
                region: account.region.clone(),
                found_in_other_account: !account.is_active,
            });
        }
    }

    Err(AppError::validation(format!(
        "Job {job_id} was not found in any configured account."
    )))
}

/// List the ids of all virtual clusters in an account, across every state
/// (RUNNING, TERMINATED, …) and all pages. Pagination is bounded to the same
/// limit the app uses elsewhere so a huge account can't loop forever.
async fn list_virtual_cluster_ids(
    client: &aws_sdk_emrcontainers::Client,
) -> AppResult<Vec<String>> {
    const MAX_EMR_PAGINATION_PAGES: usize = 100;

    let mut ids = Vec::new();
    let mut next_token = None;
    let mut pages = 0usize;

    loop {
        pages += 1;
        if pages > MAX_EMR_PAGINATION_PAGES {
            crate::diagnostics::append_log_line(
                "WARN",
                "find-job-by-id: stopped ListVirtualClusters pagination after reaching the page limit.",
            );
            break;
        }

        let mut operation = client.list_virtual_clusters();
        if let Some(token) = next_token.as_deref() {
            operation = operation.next_token(token);
        }
        let response = operation
            .send()
            .await
            .map_err(|e| AppError::aws_for_account_sdk("emr-containers", "unknown", e))?;

        ids.extend(
            response
                .virtual_clusters()
                .iter()
                .filter_map(|vc| vc.id().map(|id| id.to_string())),
        );

        next_token = response.next_token().map(String::from);
        if next_token.is_none() {
            break;
        }
    }

    Ok(ids)
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

