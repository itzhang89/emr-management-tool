use crate::aws::runtime::runtime_for_context;
use crate::error::{AppError, AppResult};
use crate::models::{
    AwsCommandContext, JobLogStream, JobLogStreamsRequest, JobLogStreamsResponse, JobLogsRequest,
    JobLogsResponse, LogEntry,
};
use chrono::{TimeZone, Utc};
use serde_json::Value;
use tauri::AppHandle;

const MAX_JSON_NORMALIZATION_DEPTH: usize = 16;

#[tauri::command]
pub async fn list_job_log_streams(
    app: AppHandle,
    request: JobLogStreamsRequest,
) -> AppResult<JobLogStreamsResponse> {
    if request.job_id.trim().is_empty()
        || request.log_group_name.trim().is_empty()
        || request.stream_name_prefix.trim().is_empty()
    {
        return Err(AppError::validation(
            "Job id, log group name, and stream prefix are required to list log streams.",
        ));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_cloudwatchlogs::Client::new(&runtime.config);
    let mut operation = client
        .describe_log_streams()
        .log_group_name(&request.log_group_name)
        .log_stream_name_prefix(&request.stream_name_prefix)
        .order_by(aws_sdk_cloudwatchlogs::types::OrderBy::LogStreamName);

    if let Some(token) = request.next_token.clone() {
        operation = operation.next_token(token);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("cloudwatchlogs", runtime.account.id, error))?;
    let streams = response
        .log_streams()
        .iter()
        .filter_map(|stream| {
            let stream_name = stream.log_stream_name()?;
            parse_cloud_watch_log_stream(
                stream_name,
                &request.job_id,
                stream
                    .last_event_timestamp()
                    .and_then(|millis| Utc.timestamp_millis_opt(millis).single())
                    .map(|timestamp| timestamp.to_rfc3339()),
            )
        })
        .collect();

    Ok(JobLogStreamsResponse {
        job_id: request.job_id,
        streams,
        next_token: response.next_token().map(ToString::to_string),
    })
}

#[tauri::command]
pub async fn get_job_logs(app: AppHandle, request: JobLogsRequest) -> AppResult<JobLogsResponse> {
    if request.job_id.trim().is_empty() {
        return Err(AppError::validation("Job id is required to load logs."));
    }

    let runtime = runtime_for_context(
        &app,
        AwsCommandContext {
            account_id: request.account_id.clone(),
        },
    )
    .await?;
    let client = aws_sdk_cloudwatchlogs::Client::new(&runtime.config);
    let log_group_name = request
        .log_group_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("/aws/emr-containers/jobs/{}", request.job_id));
    let mut operation = client
        .filter_log_events()
        .log_group_name(log_group_name)
        .limit(request.limit.unwrap_or(500));

    if let Some(stream_name) = request
        .log_stream_name
        .clone()
        .filter(|value| !value.trim().is_empty())
    {
        operation = operation.log_stream_names(stream_name);
    } else if let Some(prefix) = request
        .stream_name_prefix
        .clone()
        .filter(|value| !value.trim().is_empty())
    {
        operation = operation.log_stream_name_prefix(prefix);
    }
    if let Some(token) = request.next_forward_token.clone() {
        operation = operation.next_token(token);
    }
    if let Some(pattern) = request
        .filter_pattern
        .clone()
        .filter(|value| !value.trim().is_empty())
    {
        operation = operation.filter_pattern(pattern);
    }

    let response = operation
        .send()
        .await
        .map_err(|error| AppError::aws_for_account("cloudwatchlogs", runtime.account.id, error))?;

    let entries = response
        .events()
        .iter()
        .filter_map(|event| {
            let stream_name = event.log_stream_name().unwrap_or_default();
            if !matches_log_type(stream_name, &request.job_id, request.log_type.as_deref()) {
                return None;
            }

            let normalized = normalize_event_message(event.message().unwrap_or_default());
            Some(LogEntry {
                timestamp: event
                    .timestamp()
                    .and_then(|millis| Utc.timestamp_millis_opt(millis).single())
                    .map(|timestamp| timestamp.to_rfc3339())
                    .unwrap_or_default(),
                level: normalized.level,
                message: normalized.message,
                stream_name: stream_name.to_string(),
            })
        })
        .collect();

    Ok(JobLogsResponse {
        job_id: request.job_id,
        entries,
        next_forward_token: response.next_token().map(ToString::to_string),
    })
}

struct NormalizedLogMessage {
    message: String,
    level: String,
}

fn normalize_event_message(message: &str) -> NormalizedLogMessage {
    let parse_input = message.trim();
    if parse_input.is_empty() {
        return normalized_plain_message("");
    }

    serde_json::from_str::<Value>(parse_input)
        .ok()
        .and_then(|value| normalize_json_message(&value, 1))
        .unwrap_or_else(|| normalized_plain_message(message))
}

fn normalize_json_message(value: &Value, depth: usize) -> Option<NormalizedLogMessage> {
    if depth > MAX_JSON_NORMALIZATION_DEPTH {
        return normalized_json_fallback(value, None);
    }

    match value {
        Value::String(message) => Some(normalized_message_from_string(message, None, depth + 1)),
        Value::Object(object) => {
            let explicit_level = first_string(value, &["level", "severity", "logLevel"]);
            if is_time_only_event(object) {
                return Some(NormalizedLogMessage {
                    message: String::new(),
                    level: normalize_level(explicit_level, "")
                        .unwrap_or_else(|| "info".to_string()),
                });
            }
            let message_value = ["message", "msg", "log", "@message"]
                .iter()
                .find_map(|key| object.get(*key));
            let Some(message_value) = message_value else {
                return normalized_json_fallback(value, explicit_level);
            };

            match message_value {
                Value::String(message) => Some(normalized_message_from_string(
                    message,
                    explicit_level,
                    depth + 1,
                )),
                nested => normalized_json_fallback(nested, explicit_level),
            }
        }
        _ => normalized_json_fallback(value, None),
    }
}

fn normalized_json_fallback(
    value: &Value,
    explicit_level: Option<&str>,
) -> Option<NormalizedLogMessage> {
    let message = serde_json::to_string(value).ok()?;
    let level = normalize_level(explicit_level, &message)
        .unwrap_or_else(|| infer_level(&message).to_string());
    Some(NormalizedLogMessage { message, level })
}

fn normalized_message_from_string(
    message: &str,
    explicit_level: Option<&str>,
    depth: usize,
) -> NormalizedLogMessage {
    let parse_input = message.trim();
    if depth <= MAX_JSON_NORMALIZATION_DEPTH {
        if let Ok(nested) = serde_json::from_str::<Value>(parse_input) {
            if let Some(mut normalized) = normalize_json_message(&nested, depth + 1) {
                if let Some(level) = normalize_level(explicit_level, &normalized.message) {
                    normalized.level = level;
                }
                return normalized;
            }
        }
    }

    let message = strip_trailing_line_endings(message).to_string();
    let level = normalize_level(explicit_level, &message)
        .unwrap_or_else(|| infer_level(&message).to_string());
    NormalizedLogMessage { message, level }
}

fn normalized_plain_message(message: &str) -> NormalizedLogMessage {
    let message = strip_trailing_line_endings(message).to_string();
    let level = infer_level(&message).to_string();
    NormalizedLogMessage { message, level }
}

fn strip_trailing_line_endings(message: &str) -> &str {
    message.trim_end_matches(['\r', '\n'])
}

fn is_time_only_event(object: &serde_json::Map<String, Value>) -> bool {
    object.len() == 1 && object.contains_key("time")
}

fn first_string<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn normalize_level(level: Option<&str>, message: &str) -> Option<String> {
    let level = level?;
    let lower = level.to_lowercase();
    let normalized =
        if lower.contains("error") || lower.contains("fatal") || lower.contains("exception") {
            "error"
        } else if lower.contains("warn") {
            "warn"
        } else if lower.contains("debug") || lower.contains("trace") {
            "debug"
        } else if lower.contains("info") {
            "info"
        } else {
            infer_level(message)
        };
    Some(normalized.to_string())
}

fn matches_log_type(stream_name: &str, job_id: &str, log_type: Option<&str>) -> bool {
    let Some(log_type) = log_type.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };
    if log_type.eq_ignore_ascii_case("all") || log_type.eq_ignore_ascii_case("cloudwatch") {
        return true;
    }

    let is_driver = is_driver_stream(stream_name, job_id);
    let is_executor = is_executor_stream(stream_name, job_id);
    match log_type.to_lowercase().as_str() {
        "driver" => is_driver,
        "executor" => is_executor,
        "controller" | "submitter" => !is_driver && !is_executor,
        _ => true,
    }
}

fn parse_cloud_watch_log_stream(
    stream_name: &str,
    job_id: &str,
    last_event_timestamp: Option<String>,
) -> Option<JobLogStream> {
    let parsed = parse_emr_log_path(stream_name, job_id)?;
    let label = format!("{} {}", parsed.pod, parsed.stream);
    Some(JobLogStream {
        source: "cloudwatch".to_string(),
        id: stream_name.to_string(),
        label,
        r#type: parsed.log_type,
        container: parsed.container,
        pod: parsed.pod,
        stream: parsed.stream,
        cloud_watch_stream_name: stream_name.to_string(),
        last_event_timestamp,
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

fn is_driver_stream(stream_name: &str, job_id: &str) -> bool {
    let stream = stream_name.to_lowercase();
    let job_driver_segment = format!("spark-{}-driver", job_id).to_lowercase();
    stream.contains(&job_driver_segment) || stream.contains("-driver/")
}

fn is_executor_stream(stream_name: &str, job_id: &str) -> bool {
    let stream = stream_name.to_lowercase();
    !is_driver_stream(stream_name, job_id)
        && (stream.contains("executor") || stream.contains("-exec-"))
}

fn infer_level(message: &str) -> &'static str {
    let lower = message.to_lowercase();
    if lower.contains("error") || lower.contains("exception") {
        "error"
    } else if lower.contains("warn") {
        "warn"
    } else {
        "info"
    }
}

#[cfg(test)]
mod tests {
    use super::{matches_log_type, normalize_event_message};

    #[test]
    fn normalizes_json_event_message_into_readable_log_text() {
        let normalized = normalize_event_message(
            r#"{"time":"2026-06-10T00:00:00Z","level":"ERROR","message":"executor failed","logger":"spark"}"#,
        );

        assert_eq!(normalized.message, "executor failed");
        assert_eq!(normalized.level, "error");
    }

    #[test]
    fn normalizes_container_json_log_field_and_infers_level() {
        let normalized = normalize_event_message(
            r#"{"log":"2026-06-10 00:00:00 WARN Retrying failed task\n","stream":"stderr"}"#,
        );

        assert_eq!(
            normalized.message,
            "2026-06-10 00:00:00 WARN Retrying failed task"
        );
        assert_eq!(normalized.level, "warn");
    }

    #[test]
    fn normalizes_time_only_json_event_as_blank_message() {
        let normalized = normalize_event_message(r#"{"time":"2026-06-12T16:33:32+00:00"}"#);

        assert_eq!(normalized.message, "");
        assert_eq!(normalized.level, "info");
    }

    #[test]
    fn preserves_json_message_indentation() {
        let normalized = normalize_event_message(
            r#"{"time":"2026-06-10T00:00:00Z","level":"INFO","message":"    nested line"}"#,
        );

        assert_eq!(normalized.message, "    nested line");
        assert_eq!(normalized.level, "info");
    }

    #[test]
    fn stops_unwrapping_deeply_nested_json_strings() {
        let mut value = serde_json::json!("payload");
        for _ in 0..20 {
            value = serde_json::Value::String(value.to_string());
        }

        let normalized = normalize_event_message(&value.to_string());

        assert_ne!(normalized.message, "payload");
        assert!(normalized.message.contains("payload"));
        assert_eq!(normalized.level, "info");
    }

    #[test]
    fn classifies_emr_on_eks_log_stream_types() {
        let driver_stream =
            "prefix/vc-1/jobs/job-running/containers/spark-app/spark-job-running-driver/stdout";
        let executor_stream = "prefix/vc-1/jobs/job-running/containers/spark-app/executor-1/stdout";
        let controller_stream = "prefix/vc-1/jobs/job-running/containers/job-runner/stdout";

        assert!(matches_log_type(
            driver_stream,
            "job-running",
            Some("driver")
        ));
        assert!(matches_log_type(
            executor_stream,
            "job-running",
            Some("executor")
        ));
        assert!(matches_log_type(
            controller_stream,
            "job-running",
            Some("controller")
        ));
        assert!(matches_log_type(driver_stream, "job-running", None));
    }
}
