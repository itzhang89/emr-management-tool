//! Parsing of EMR on EKS log paths.
//!
//! Both CloudWatch stream names and S3 archive keys address a job's logs with
//! the same layout under `.../jobs/<job_id>/`:
//!
//! ```text
//! containers/<container>/<pod>/<stream>   driver + executor pods
//! control-logs/<pod>/<stream>             the job-runner / control pod
//! ```
//!
//! This module is the single implementation. It previously lived duplicated in
//! `commands::s3` and `commands::logs`, which is how `control-logs` came to be
//! recognized on the S3 path but silently dropped on the CloudWatch one.
//!
//! Mirrors `src/services/emrLogTree.ts` on the frontend; keep the two in sync.

const CONTAINERS_SEGMENT: &str = "containers";
const CONTROL_LOGS_SEGMENT: &str = "control-logs";

pub struct ParsedLogPath {
    pub log_type: String,
    pub container: String,
    pub pod: String,
    pub stream: String,
}

/// Parse a log path into its EMR identity, or `None` when the path is not a
/// pod log (e.g. `job-metadata.log`, or an unrecognized subtree).
pub fn parse_emr_log_path(path: &str, job_id: &str) -> Option<ParsedLogPath> {
    let parts = path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let job_id_index = parts
        .windows(2)
        .position(|window| window[0] == "jobs" && window[1] == job_id)
        .map(|index| index + 1)?;

    let rest = &parts[(job_id_index + 1)..];
    let (section, after_section) = rest.split_first()?;

    match *section {
        CONTAINERS_SEGMENT => {
            if after_section.len() < 2 {
                return None;
            }
            let stream = after_section.last()?.to_string();
            let pod = after_section.get(after_section.len() - 2)?.to_string();
            let container = if after_section.len() > 2 {
                after_section[..after_section.len() - 2].join("/")
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
        CONTROL_LOGS_SEGMENT => {
            // Always the control pod, never a Spark pod, so classify_pod (which
            // keys off driver/exec naming) does not apply. The pod directory
            // carries a per-run random suffix, so it is read positionally.
            if after_section.len() < 2 {
                return None;
            }
            Some(ParsedLogPath {
                log_type: "controller".to_string(),
                container: CONTROL_LOGS_SEGMENT.to_string(),
                pod: after_section.get(after_section.len() - 2)?.to_string(),
                stream: after_section.last()?.to_string(),
            })
        }
        _ => None,
    }
}

pub fn classify_pod(pod: &str, job_id: &str) -> String {
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

/// Recover the job id from a log prefix like `logs/<vc>/jobs/<job_id>/`.
pub fn job_id_from_prefix(prefix: &str) -> Option<String> {
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
    use super::*;

    const JOB: &str = "0000000381t77o3g8f5";
    const VC: &str = "virtual-cluster-1";

    #[test]
    fn parses_container_driver_and_executor_paths() {
        let driver = parse_emr_log_path(
            &format!("logs/{VC}/jobs/{JOB}/containers/spark-{JOB}/spark-{JOB}-driver/stderr"),
            JOB,
        )
        .expect("driver path parses");
        assert_eq!(driver.log_type, "driver");
        assert_eq!(driver.container, format!("spark-{JOB}"));
        assert_eq!(driver.pod, format!("spark-{JOB}-driver"));
        assert_eq!(driver.stream, "stderr");

        let executor = parse_emr_log_path(
            &format!(
                "logs/{VC}/jobs/{JOB}/containers/spark-{JOB}/spark-{JOB}-890693a03d3a548b-exec-1/stdout"
            ),
            JOB,
        )
        .expect("executor path parses");
        assert_eq!(executor.log_type, "executor");
        assert_eq!(executor.pod, format!("spark-{JOB}-890693a03d3a548b-exec-1"));
        assert_eq!(executor.stream, "stdout");
    }

    #[test]
    fn parses_control_logs_as_controller_entries() {
        let parsed = parse_emr_log_path(
            &format!("logs/{VC}/jobs/{JOB}/control-logs/{JOB}-qs8tm/stderr"),
            JOB,
        )
        .expect("control-logs path parses");

        assert_eq!(parsed.log_type, "controller");
        assert_eq!(parsed.container, "control-logs");
        assert_eq!(parsed.pod, format!("{JOB}-qs8tm"));
        assert_eq!(parsed.stream, "stderr");
    }

    #[test]
    fn accepts_any_control_pod_name_since_the_suffix_is_random() {
        for pod in [
            format!("{JOB}-qs8tm"),
            format!("{JOB}-9xz2b"),
            format!("{JOB}-a1b2c3d4e5"),
            "runner-77f2b".to_string(),
        ] {
            let parsed =
                parse_emr_log_path(&format!("logs/{VC}/jobs/{JOB}/control-logs/{pod}/stderr"), JOB)
                    .unwrap_or_else(|| panic!("control-logs path parses for pod {pod}"));
            assert_eq!(parsed.log_type, "controller");
            assert_eq!(parsed.container, "control-logs");
            assert_eq!(parsed.pod, pod);
            assert_eq!(parsed.stream, "stderr");
        }
    }

    /// CloudWatch stream names carry a date prefix ahead of the virtual cluster
    /// id but the same jobs/<id>/… tail, so control-logs must resolve there too.
    #[test]
    fn parses_cloud_watch_style_paths_including_control_logs() {
        let driver = parse_emr_log_path(
            &format!("20260612/{VC}/jobs/{JOB}/containers/spark-{JOB}/spark-{JOB}-driver/stderr"),
            JOB,
        )
        .expect("cloudwatch driver stream parses");
        assert_eq!(driver.log_type, "driver");

        let control = parse_emr_log_path(
            &format!("20260612/{VC}/jobs/{JOB}/control-logs/{JOB}-qs8tm/stderr"),
            JOB,
        )
        .expect("cloudwatch control-logs stream parses");
        assert_eq!(control.log_type, "controller");
        assert_eq!(control.pod, format!("{JOB}-qs8tm"));
    }

    #[test]
    fn ignores_job_level_files_outside_the_log_subtrees() {
        // job-metadata.log sits directly under the job prefix — not a pod log.
        assert!(parse_emr_log_path(&format!("logs/{VC}/jobs/{JOB}/job-metadata.log"), JOB).is_none());
        // A control-logs entry with no stream segment is incomplete.
        assert!(parse_emr_log_path(&format!("logs/{VC}/jobs/{JOB}/control-logs/pod"), JOB).is_none());
        // Unknown subtree names are not guessed at.
        assert!(
            parse_emr_log_path(&format!("logs/{VC}/jobs/{JOB}/other-logs/pod/stderr"), JOB).is_none()
        );
    }
}
