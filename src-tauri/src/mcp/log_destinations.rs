//! Job log destination resolution.
//!
//! Ported from `mcp/src/tools/jobLogDestinations.ts`, which itself mirrors the
//! desktop app's `src/services/jobLogDestinations.ts`. A job's logs are
//! addressed exactly the way the Logs page addresses them when the user clicks
//! "Logs" — keep the three in sync.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudWatchDestination {
    pub log_group_name: String,
    pub stream_name_prefix: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3Destination {
    pub bucket: String,
    pub prefix: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct JobLogDestinations {
    pub cloud_watch: Option<CloudWatchDestination>,
    pub s3: Option<S3Destination>,
}

/// Conventional EMR on EKS destination, used when a job has no monitoring
/// configuration at all (logs then default to this CloudWatch group).
pub fn default_cloud_watch_destination(job_id: &str) -> CloudWatchDestination {
    CloudWatchDestination {
        log_group_name: format!("/aws/emr-containers/jobs/{job_id}"),
        stream_name_prefix: Some(job_id.to_string()),
    }
}

pub fn build_cloud_watch_stream_prefix(
    log_stream_name_prefix: Option<&str>,
    virtual_cluster_id: &str,
    job_id: &str,
) -> String {
    let base = log_stream_name_prefix.unwrap_or("").trim();
    let normalized = if !base.is_empty() && !base.ends_with('/') {
        format!("{base}/")
    } else {
        base.to_string()
    };
    format!("{normalized}{virtual_cluster_id}/jobs/{job_id}/")
}

/// Split an `s3://bucket/prefix` URI. The returned prefix always ends in `/`
/// (or is empty), so callers can concatenate onto it directly.
pub fn parse_s3_uri(uri: &str) -> Option<(String, String)> {
    let trimmed = uri.trim();
    let rest = trimmed.strip_prefix("s3://")?;
    let (bucket, prefix) = match rest.split_once('/') {
        Some((bucket, prefix)) => (bucket, prefix),
        None => (rest, ""),
    };
    if bucket.is_empty() {
        return None;
    }
    let prefix = if !prefix.is_empty() && !prefix.ends_with('/') {
        format!("{prefix}/")
    } else {
        prefix.to_string()
    };
    Some((bucket.to_string(), prefix))
}

pub fn build_s3_log_prefix(
    log_uri: &str,
    virtual_cluster_id: &str,
    job_id: &str,
) -> Option<S3Destination> {
    let (bucket, prefix) = parse_s3_uri(log_uri)?;
    Some(S3Destination {
        bucket,
        prefix: format!("{prefix}{virtual_cluster_id}/jobs/{job_id}/"),
    })
}

/// Resolve a job's configured log destinations from its
/// `configurationOverrides.monitoringConfiguration`.
///
/// `configuration_overrides` is the raw JSON the EMR describe call returned —
/// the app stores it untyped, so it is navigated by key here.
pub fn resolve(
    job_id: &str,
    virtual_cluster_id: &str,
    configuration_overrides: Option<&serde_json::Value>,
) -> JobLogDestinations {
    let monitoring = configuration_overrides.and_then(|overrides| {
        overrides
            .get("monitoringConfiguration")
            .or_else(|| overrides.get("monitoring_configuration"))
    });

    let mut destinations = JobLogDestinations::default();
    let Some(monitoring) = monitoring else {
        return destinations;
    };

    let cloud_watch_config = monitoring
        .get("cloudWatchMonitoringConfiguration")
        .or_else(|| monitoring.get("cloud_watch_monitoring_configuration"));
    if let Some(config) = cloud_watch_config {
        let log_group = config
            .get("logGroupName")
            .or_else(|| config.get("log_group_name"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(log_group) = log_group {
            let stream_prefix = config
                .get("logStreamNamePrefix")
                .or_else(|| config.get("log_stream_name_prefix"))
                .and_then(|value| value.as_str());
            destinations.cloud_watch = Some(CloudWatchDestination {
                log_group_name: log_group.to_string(),
                stream_name_prefix: Some(build_cloud_watch_stream_prefix(
                    stream_prefix,
                    virtual_cluster_id,
                    job_id,
                )),
            });
        }
    }

    let s3_config = monitoring
        .get("s3MonitoringConfiguration")
        .or_else(|| monitoring.get("s3_monitoring_configuration"));
    if let Some(config) = s3_config {
        let log_uri = config
            .get("logUri")
            .or_else(|| config.get("log_uri"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(log_uri) = log_uri {
            destinations.s3 = build_s3_log_prefix(log_uri, virtual_cluster_id, job_id);
        }
    }

    destinations
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn default_destination_uses_the_conventional_group() {
        let destination = default_cloud_watch_destination("job-1");
        assert_eq!(destination.log_group_name, "/aws/emr-containers/jobs/job-1");
        assert_eq!(destination.stream_name_prefix.as_deref(), Some("job-1"));
    }

    #[test]
    fn stream_prefix_appends_a_slash_to_the_base() {
        assert_eq!(
            build_cloud_watch_stream_prefix(Some("team"), "vc-1", "job-1"),
            "team/vc-1/jobs/job-1/"
        );
        // An already-slashed base is not doubled.
        assert_eq!(
            build_cloud_watch_stream_prefix(Some("team/"), "vc-1", "job-1"),
            "team/vc-1/jobs/job-1/"
        );
        // No base prefix at all.
        assert_eq!(
            build_cloud_watch_stream_prefix(None, "vc-1", "job-1"),
            "vc-1/jobs/job-1/"
        );
    }

    #[test]
    fn parses_s3_uris() {
        assert_eq!(
            parse_s3_uri("s3://bucket/logs"),
            Some(("bucket".to_string(), "logs/".to_string()))
        );
        assert_eq!(
            parse_s3_uri("s3://bucket/logs/"),
            Some(("bucket".to_string(), "logs/".to_string()))
        );
        assert_eq!(
            parse_s3_uri("s3://bucket"),
            Some(("bucket".to_string(), String::new()))
        );
        assert_eq!(parse_s3_uri("https://example.com/logs"), None);
        assert_eq!(parse_s3_uri("s3:///logs"), None);
    }

    #[test]
    fn builds_the_job_s3_prefix() {
        assert_eq!(
            build_s3_log_prefix("s3://bucket/logs", "vc-1", "job-1"),
            Some(S3Destination {
                bucket: "bucket".to_string(),
                prefix: "logs/vc-1/jobs/job-1/".to_string(),
            })
        );
    }

    #[test]
    fn resolves_both_destinations_from_monitoring_config() {
        let overrides = json!({
            "monitoringConfiguration": {
                "cloudWatchMonitoringConfiguration": {
                    "logGroupName": "/aws/emr-containers/jobs",
                    "logStreamNamePrefix": "team",
                },
                "s3MonitoringConfiguration": {"logUri": "s3://bucket/logs"},
            }
        });

        let destinations = resolve("job-1", "vc-1", Some(&overrides));
        assert_eq!(
            destinations.cloud_watch,
            Some(CloudWatchDestination {
                log_group_name: "/aws/emr-containers/jobs".to_string(),
                stream_name_prefix: Some("team/vc-1/jobs/job-1/".to_string()),
            })
        );
        assert_eq!(
            destinations.s3,
            Some(S3Destination {
                bucket: "bucket".to_string(),
                prefix: "logs/vc-1/jobs/job-1/".to_string(),
            })
        );
    }

    #[test]
    fn resolves_nothing_without_monitoring_config() {
        assert_eq!(
            resolve("job-1", "vc-1", None),
            JobLogDestinations::default()
        );
        let empty = json!({});
        assert_eq!(
            resolve("job-1", "vc-1", Some(&empty)),
            JobLogDestinations::default()
        );
        // A blank log group is ignored rather than producing an empty group name.
        let blank = json!({
            "monitoringConfiguration": {
                "cloudWatchMonitoringConfiguration": {"logGroupName": "   "}
            }
        });
        assert_eq!(
            resolve("job-1", "vc-1", Some(&blank)),
            JobLogDestinations::default()
        );
    }
}
