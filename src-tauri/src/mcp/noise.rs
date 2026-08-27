//! Spark log noise filtering.
//!
//! Ported from `filterLogNoise` in `mcp/src/tools/analyzeJobFailure.ts`. Given
//! raw log text, drop the routine informational chatter (SLF4J notices, noisy
//! per-task INFO lines) and report how many lines were hidden — the "simplified
//! log" the analysis tool feeds on.

use std::sync::LazyLock;

use regex::Regex;

/// `23/08/01 10:00:02 INFO TaskSetManager: message`
static SPARK_LINE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{2}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERROR|DEBUG|TRACE) ([^:]+): (.*)$")
        .unwrap()
});

/// Noise loggers whose INFO lines are hidden.
const NOISE_LOGGERS: &[&str] = &[
    "TaskSetManager", "DAGScheduler", "BlockManagerInfo", "TaskSchedulerImpl",
    "MemoryStore", "CodeGenerator", "AppInfoParser", "Metrics", "SecurityManager",
    "ResourceUtils", "JettyUtils", "SparkEnv", "DiskBlockManager",
    "CoarseGrainedExecutorBackend", "ShuffleBlockFetcherIterator", "TorrentBroadcast",
    "FileScanRDD", "MapPartitionsRDD", "TransportClientFactory", "HiveConf",
    "SharedState", "SubResultCacheManager", "ContextCleaner", "SignalUtils",
    "NativeCodeLoader", "ShutdownHookManager", "CodecPool", "SchedulerExtensionServices",
];

const NOISE_PREFIXES: &[&str] = &[
    "MapOutputTracker", "ResourceProfile", "BlockManager", "YarnScheduler",
];

fn is_noise_logger(logger: &str) -> bool {
    let base = logger.split('$').next().unwrap_or(logger);
    if NOISE_LOGGERS.contains(&base) {
        return true;
    }
    NOISE_PREFIXES.iter().any(|prefix| base.starts_with(prefix))
}

/// Spark-format lines that are routine informational chatter not worth shipping
/// to the model as raw evidence. Applied on top of `filter`'s conservative
/// keep rules when assembling evidence.rawLogs.
pub fn is_generic_noise_info(line: &str) -> bool {
    let generic = LazyLock::<Regex>::new(|| {
        Regex::new(r"^\d{2}/\d{2}/\d{2} \d{2}:\d{2}:\d{2} INFO [^:]+:").unwrap()
    });
    generic.is_match(line)
}

/// Routine per-task INFO chatter that adds nothing for root-cause analysis.
fn is_routine_info(logger: &str, message: &str) -> bool {
    if logger == "Executor"
        && (message.starts_with("Running task") || message.starts_with("Finished task"))
    {
        return true;
    }
    if logger == "SparkContext"
        && !["Running Spark version", "Submitted application"]
            .iter()
            .any(|keyword| message.contains(keyword))
    {
        return true;
    }
    if logger == "TaskSetManager" && message.contains("Finished task") {
        return true;
    }
    if logger == "blockManager.BlockManagerStore" || message.starts_with("asked to send block") {
        return true;
    }
    false
}

pub struct FilteredText {
    pub text: String,
    pub hidden_count: usize,
}

/// Drop noise lines from Spark log text. Lines outside the Spark format (raw
/// Python tracebacks, custom loggers) are always kept.
pub fn filter(text: &str) -> FilteredText {
    if text.is_empty() {
        return FilteredText {
            text: String::new(),
            hidden_count: 0,
        };
    }

    let mut kept: Vec<&str> = Vec::new();
    let mut hidden_count = 0usize;

    for line in text.split('\n') {
        if line.starts_with("SLF4J:") {
            hidden_count += 1;
            continue;
        }

        let Some(captures) = SPARK_LINE_RE.captures(line) else {
            kept.push(line);
            continue;
        };

        let level = &captures[2];
        let logger = &captures[3];
        let message = &captures[4];

        if level == "INFO" && (is_noise_logger(logger) || is_routine_info(logger, message)) {
            hidden_count += 1;
            continue;
        }

        kept.push(line);
    }

    FilteredText {
        text: kept.join("\n"),
        hidden_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_error_and_warn_lines() {
        let input = "23/08/01 10:00:02 ERROR SparkContext: Job failed\n\
23/08/01 10:00:03 WARN DAGScheduler: Job 100 failed";
        let result = filter(input);
        assert_eq!(result.hidden_count, 0);
        assert_eq!(result.text, input);
    }

    #[test]
    fn hides_noisy_info_loggers() {
        let input = "23/08/01 10:00:02 INFO TaskSetManager: Starting task 1 of 10\n\
23/08/01 10:00:03 INFO BlockManagerInfo: Added broadcast\n\
23/08/01 10:00:04 INFO SparkContext: Submitting application";
        let result = filter(input);
        // All three are hidden: TaskSetManager/BlockManagerInfo are noise
        // loggers, and SparkContext's "Submitting application" is routine
        // chatter too (only "Running Spark version" / "Submitted application"
        // are kept) — matching the TS filterLogNoise.
        assert_eq!(result.hidden_count, 3);
        assert!(!result.text.contains("Starting task"));
        assert!(!result.text.contains("Added broadcast"));
        assert!(!result.text.contains("Submitting application"));
    }

    #[test]
    fn keeps_interesting_spark_context_lines() {
        let input = "23/08/01 10:00:04 INFO SparkContext: Running Spark version 3.5\n\
23/08/01 10:00:05 INFO SparkContext: Submitted application job-1";
        let result = filter(input);
        assert_eq!(result.hidden_count, 0);
        assert_eq!(result.text, input);
    }

    #[test]
    fn hides_routine_executor_task_chatter() {
        let input = "23/08/01 10:00:02 INFO Executor: Running task 1.0 in stage 0\n\
23/08/01 10:00:03 INFO Executor: Finished task 1.0 in stage 0";
        let result = filter(input);
        assert_eq!(result.hidden_count, 2);
    }

    #[test]
    fn keeps_non_spark_lines() {
        let input = "Traceback (most recent call last):\n\
  File \"job.py\", line 42, in transform\n\
    raise ValueError(\"bad\")";
        let result = filter(input);
        assert_eq!(result.hidden_count, 0);
        assert_eq!(result.text, input);
    }

    #[test]
    fn hides_slf4j_notices() {
        let input = "SLF4J: Failed to load class\n\
23/08/01 10:00:02 ERROR SparkContext: boom";
        let result = filter(input);
        assert_eq!(result.hidden_count, 1);
    }

    #[test]
    fn empty_input() {
        let result = filter("");
        assert_eq!(result.text, "");
        assert_eq!(result.hidden_count, 0);
    }
}
