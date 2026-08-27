//! Failure analysis extractor.
//!
//! Ported from `mcp/src/analysis/index.ts`. Given simplified log text, extract:
//! - Traceback blocks (`Caused by:`, `Exception in thread`, stack frames, and
//!   Python `Traceback (most recent call last):` blocks)
//! - ETL `stepId` markers for step context
//! - Heuristic candidate causes matched from a known-pattern table
//!
//! Deterministic heuristics only — no LLM. The calling model does the final
//! judgement on the evidence this produces.

use serde::Serialize;
use std::sync::LazyLock;

use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateCause {
    pub cause: String,
    /// "high" | "medium" | "low"
    pub confidence: String,
    pub evidence: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedErrorSection {
    /// Last 30 ERROR/WARN lines.
    pub error_tail: Vec<String>,
    /// Extracted traceback blocks.
    pub tracebacks: Vec<String>,
    /// Deepest `Caused by` chain — the most likely root cause.
    pub deepest_caused_by: Option<String>,
    /// ETL step IDs found in the log.
    pub step_ids: Vec<String>,
    pub candidate_causes: Vec<CandidateCause>,
}

/// Safety bound so a malformed traceback can't swallow the whole file.
const MAX_PY_BLOCK_LINES: usize = 80;
/// How many error lines the tail reports.
const ERROR_TAIL_LINES: usize = 30;

static STEP_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^-- stepId=(\d+)\s*$").unwrap());
static CAUSED_BY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^Caused by:\s*(.+)$").unwrap());
static EXCEPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^(Exception in thread "[^"]+"|.+Exception|.+Error|.+Throwable)"#).unwrap()
});
/// Exception declarations that appear behind a log-level prefix, e.g.
/// `23/08/01 10:00:02 ERROR YarnSchedulerBackend: org.apache.spark.SparkException: Job aborted`
static LEVEL_EXCEPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\s(?:FATAL|ERROR|WARN)\s.*[\w.$]+(?:Exception|Error|Throwable):").unwrap()
});
static STACK_FRAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s+at\s+.+\(.+\)$").unwrap());
static ELLIPSIS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\.\.\. \d+ more$").unwrap());
static PY_TRACEBACK_START_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^Traceback \(most recent call last\):").unwrap());
static PY_EXCEPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit)(?::\s|$)").unwrap()
});
static PY_FRAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s+(?:File|During handling of)").unwrap());
static INDENTED_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s+\S").unwrap());
static ERROR_LEVEL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(?:FATAL|ERROR|WARN)\b").unwrap());

/// Known failure signatures, in priority order. The first pattern to match a
/// given cause wins; each cause is reported at most once.
struct CausePattern {
    pattern: &'static str,
    cause: &'static str,
    confidence: &'static str,
}

/// `(?i)` prefixes mirror the TS `/i` flag; `(?m)` mirrors `/m` for the two
/// Python patterns that anchor to a line start.
const CAUSE_PATTERNS: &[CausePattern] = &[
    // OOM / memory
    CausePattern {
        pattern: r"(?i)OutOfMemoryError|Container killed by YARN|Memory limit exceeded|Killed\s+(due to|by)|exceeded memory limit|OOMKilled|MemoryError",
        cause: "OOM / executors killed",
        confidence: "high",
    },
    CausePattern {
        pattern: r"(?i)Container\s+\S+\s+is\s+RUNNING\s+but\s+not\s+responding",
        cause: "Executor lost / container stuck",
        confidence: "medium",
    },
    // Permission / IAM
    CausePattern {
        pattern: r"(?i)AccessDenied|Permission denied|NoSuchBucket|AccessDeniedException",
        cause: "S3/IAM permission denied",
        confidence: "high",
    },
    CausePattern {
        pattern: r"(?i)User:\s+arn:aws:sts::\d{12}:assumed-role/\S+is not authorized",
        cause: "IAM role not authorized",
        confidence: "high",
    },
    // Missing class / jar
    CausePattern {
        pattern: r"(?i)ClassNotFoundException|NoClassDefFoundError|No such file or class",
        cause: "Missing jar or classpath dependency",
        confidence: "high",
    },
    CausePattern {
        pattern: r"(?i)MethodNotFound|NoSuchMethodError",
        cause: "Version mismatch / incompatible API",
        confidence: "medium",
    },
    // Bad SQL / script
    CausePattern {
        pattern: r"(?i)ParseException|AnalysisException|mismatched input|InvalidInputException",
        cause: "Bad SQL or script syntax",
        confidence: "high",
    },
    CausePattern {
        pattern: r"(?i)Table not found|View not found|Database.*not found|Relation.*not found",
        cause: "Missing table or view in SQL",
        confidence: "high",
    },
    CausePattern {
        pattern: r"(?i)Column.*not found|Cannot resolve",
        cause: "Missing column in SQL query",
        confidence: "high",
    },
    // Stage failure
    CausePattern {
        pattern: r"(?i)SparkException.*Job aborted|Stage failed|Task failed",
        cause: "Spark stage failure",
        confidence: "medium",
    },
    CausePattern {
        pattern: r"(?i)Shuffle.*failed|Shuffle.*error",
        cause: "Shuffle failure (data skew / partition issue)",
        confidence: "medium",
    },
    // Script exit
    CausePattern {
        pattern: r"(?i)command not found|Non-zero exit|Script returned exit code|Exit code",
        cause: "Script exit code failure",
        confidence: "medium",
    },
    // Cancelled
    CausePattern {
        pattern: r"(?i)CANCELLED|CancelJobRun|Job run cancelled",
        cause: "Job cancelled by user",
        confidence: "high",
    },
    // Resource / throttle
    CausePattern {
        pattern: r"(?i)Throttling|Rate exceeded|LimitExceeded|TooManyRequests",
        cause: "AWS API throttling / rate limit",
        confidence: "medium",
    },
    CausePattern {
        pattern: r"(?i)Timed out|Timeout|timedout",
        cause: "Operation timed out",
        confidence: "medium",
    },
    CausePattern {
        pattern: r"(?i)No space left|Disk quota|DiskFull",
        cause: "Disk space exhausted",
        confidence: "high",
    },
    // Python runtime errors (PySpark UDFs, python scripts)
    CausePattern {
        pattern: r"(?m)^MemoryError(?::\s|$)",
        cause: "Python MemoryError",
        confidence: "high",
    },
    CausePattern {
        pattern: r"(?m)^(KeyError|ValueError|TypeError|AttributeError)(?::\s|$)",
        cause: "Python runtime error",
        confidence: "medium",
    },
];

fn compiled_cause_patterns() -> &'static [(Regex, &'static str, &'static str)] {
    static COMPILED: LazyLock<Vec<(Regex, &'static str, &'static str)>> = LazyLock::new(|| {
        CAUSE_PATTERNS
            .iter()
            .map(|entry| {
                (
                    Regex::new(entry.pattern).expect("cause pattern compiles"),
                    entry.cause,
                    entry.confidence,
                )
            })
            .collect()
    });
    &COMPILED
}

pub fn extract_error_sections(simplified_text: &str) -> ExtractedErrorSection {
    if simplified_text.is_empty() {
        return ExtractedErrorSection::default();
    }

    let mut tracebacks: Vec<String> = Vec::new();
    let mut step_ids: Vec<String> = Vec::new();
    let mut all_errors: Vec<String> = Vec::new();

    // Java traceback accumulation state.
    let mut current_traceback: Option<Vec<String>> = None;
    let mut current_is_level_prefixed = false;
    // Python traceback accumulation state.
    let mut py_block: Option<Vec<String>> = None;

    for line in simplified_text.split('\n') {
        let is_error = ERROR_LEVEL_RE.is_match(line);
        let is_caused_by = CAUSED_BY_RE.is_match(line);
        let is_java_exception = EXCEPTION_RE.is_match(line) || LEVEL_EXCEPTION_RE.is_match(line);
        let is_py_exception = PY_EXCEPTION_RE.is_match(line);
        let is_stack_frame = STACK_FRAME_RE.is_match(line);
        let is_ellipsis = ELLIPSIS_RE.is_match(line);

        if let Some(captures) = STEP_ID_RE.captures(line) {
            step_ids.push(captures[1].to_string());
        }

        // Python traceback blocks: start on the header, collect "  File …"
        // frames (including chained "During handling of another exception:"
        // blocks) up to the final unindented exception line.
        if PY_TRACEBACK_START_RE.is_match(line) {
            py_block = Some(vec![line.to_string()]);
            continue;
        }
        if let Some(block) = py_block.as_mut() {
            let is_py_frame = PY_FRAME_RE.is_match(line);
            if is_py_frame || INDENTED_RE.is_match(line) {
                block.push(line.to_string());
                if block.len() > MAX_PY_BLOCK_LINES {
                    flush_py_block(&mut py_block, &mut tracebacks, &mut all_errors);
                }
                continue;
            }
            if is_py_exception {
                block.push(line.to_string());
                // The final exception line closes the block.
                flush_py_block(&mut py_block, &mut tracebacks, &mut all_errors);
                continue;
            }
            // Not part of the traceback; fall through to the other checks.
            flush_py_block(&mut py_block, &mut tracebacks, &mut all_errors);
        }

        // Java traceback blocks.
        if is_java_exception || is_caused_by {
            if current_traceback.is_none() {
                current_traceback = Some(Vec::new());
                current_is_level_prefixed = LEVEL_EXCEPTION_RE.is_match(line);
            }
            current_traceback
                .as_mut()
                .expect("just initialized")
                .push(line.to_string());
            if is_caused_by {
                all_errors.push(line.to_string());
            }
        } else if is_stack_frame || is_ellipsis {
            if let Some(block) = current_traceback.as_mut() {
                block.push(line.to_string());
            }
        } else {
            flush_java_traceback(
                &mut current_traceback,
                &mut current_is_level_prefixed,
                &mut tracebacks,
                &mut all_errors,
            );
        }

        // Error/warn lines for the tail.
        if is_error && !is_stack_frame && !is_ellipsis {
            all_errors.push(line.to_string());
        }
        // Standalone Python exception lines outside a traceback are evidence too.
        if is_py_exception && !is_error && py_block.is_none() {
            all_errors.push(line.to_string());
        }
    }

    flush_py_block(&mut py_block, &mut tracebacks, &mut all_errors);
    flush_java_traceback(
        &mut current_traceback,
        &mut current_is_level_prefixed,
        &mut tracebacks,
        &mut all_errors,
    );

    let error_tail: Vec<String> = all_errors
        .iter()
        .rev()
        .take(ERROR_TAIL_LINES)
        .rev()
        .cloned()
        .collect();

    let deepest_caused_by = deepest_caused_by(&all_errors, &tracebacks);
    let candidate_causes = match_causes(&all_errors);

    ExtractedErrorSection {
        error_tail,
        tracebacks,
        deepest_caused_by,
        step_ids,
        candidate_causes,
    }
}

/// A Java block behind a log-level prefix ("ERROR Foo: com.x.Exc: msg") can be
/// a single line and is still worth reporting; a bare one-line match is not.
fn flush_java_traceback(
    current: &mut Option<Vec<String>>,
    is_level_prefixed: &mut bool,
    tracebacks: &mut Vec<String>,
    all_errors: &mut Vec<String>,
) {
    if let Some(block) = current.take() {
        if block.len() > 1 || *is_level_prefixed {
            tracebacks.push(block.join("\n"));
            all_errors.extend(block);
        }
    }
    *is_level_prefixed = false;
}

fn flush_py_block(
    py_block: &mut Option<Vec<String>>,
    tracebacks: &mut Vec<String>,
    all_errors: &mut Vec<String>,
) {
    if let Some(block) = py_block.take() {
        if block.len() > 1 {
            tracebacks.push(block.join("\n"));
            all_errors.extend(block);
        }
    }
}

/// Find the deepest `Caused by` (the last one in the log). Python has no
/// `Caused by` chain, so fall back to the final exception line of the last
/// Python traceback — the closest analogue to a root cause.
fn deepest_caused_by(all_errors: &[String], tracebacks: &[String]) -> Option<String> {
    let last_caused_by = all_errors
        .iter()
        .filter_map(|line| CAUSED_BY_RE.captures(line))
        .map(|captures| captures[1].to_string())
        .next_back();
    if last_caused_by.is_some() {
        return last_caused_by;
    }

    for block in tracebacks.iter().rev() {
        if !PY_TRACEBACK_START_RE.is_match(block) {
            continue;
        }
        if let Some(line) = block
            .split('\n')
            .rev()
            .find(|line| PY_EXCEPTION_RE.is_match(line))
        {
            return Some(line.to_string());
        }
    }
    None
}

fn match_causes(lines: &[String]) -> Vec<CandidateCause> {
    let mut matched: Vec<&str> = Vec::new();
    let mut causes: Vec<CandidateCause> = Vec::new();

    for line in lines {
        for (pattern, cause, confidence) in compiled_cause_patterns() {
            if matched.contains(cause) {
                continue;
            }
            if pattern.is_match(line) {
                matched.push(cause);
                let evidence: String = line.trim().chars().take(200).collect();
                causes.push(CandidateCause {
                    cause: (*cause).to_string(),
                    confidence: (*confidence).to_string(),
                    evidence,
                });
            }
        }
    }

    causes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_cause(result: &ExtractedErrorSection, cause: &str, confidence: &str) -> bool {
        result
            .candidate_causes
            .iter()
            .any(|c| c.cause == cause && c.confidence == confidence)
    }

    #[test]
    fn collects_error_and_warn_lines() {
        let text = "23/08/01 10:00:01 INFO TaskSetManager: Starting task\n\
23/08/01 10:00:02 ERROR SparkContext: Job failed with exception\n\
23/08/01 10:00:03 WARN DAGScheduler: Job 100 failed\n\
23/08/01 10:00:04 INFO TaskSetManager: Starting another task";

        let result = extract_error_sections(text);
        assert!(result.error_tail.iter().any(|l| l.contains("ERROR")));
        assert!(result.error_tail.iter().any(|l| l.contains("WARN")));
        assert!(result.error_tail.len() >= 2);
    }

    #[test]
    fn empty_text_yields_empty_error_tail() {
        let result = extract_error_sections("");
        assert!(result.error_tail.is_empty());
        assert_eq!(result, ExtractedErrorSection::default());
    }

    #[test]
    fn extracts_spark_exception_and_stack_frame() {
        let text = concat!(
            "23/08/01 10:00:02 ERROR SparkContext: Job aborted\n",
            "Exception in thread \"main\" org.apache.spark.SparkException: Job aborted\n",
            "  at org.apache.spark.SparkContext.runJob(SparkContext.scala:2046)\n",
            "  at org.apache.spark.SparkContext.runJob(SparkContext.scala:2016)\n",
            "  ... 15 more",
        );

        let result = extract_error_sections(text);
        assert!(!result.tracebacks.is_empty());
        assert!(result.tracebacks[0].contains("SparkException"));
        assert!(result.tracebacks[0].contains("at org.apache.spark"));
    }

    #[test]
    fn extracts_caused_by_chains() {
        let text = concat!(
            "Exception in thread \"main\" java.lang.RuntimeException: outer error\n",
            "Caused by: java.io.IOException: inner error\n",
            "  at java.io.FileInputStream.open0(FileInputStream.java:195)\n",
            "Caused by: java.net.SocketTimeoutException: Connection timed out\n",
            "  at sun.nio.ch.Net.pollConnect(Native Method)",
        );

        let result = extract_error_sections(text);
        assert!(!result.tracebacks.is_empty());
    }

    #[test]
    fn deepest_caused_by_is_the_last_one() {
        let text = concat!(
            "Exception in thread \"main\" java.lang.RuntimeException: Stage failed\n",
            "Caused by: org.apache.spark.SparkException: Job aborted\n",
            "Caused by: java.io.IOException: Connection to database failed\n",
            "Caused by: java.net.SocketTimeoutException: Connection timed out",
        );

        let result = extract_error_sections(text);
        assert_eq!(
            result.deepest_caused_by.as_deref(),
            Some("java.net.SocketTimeoutException: Connection timed out")
        );
    }

    #[test]
    fn deepest_caused_by_is_none_without_a_chain() {
        let result = extract_error_sections("ERROR MyLogger: Something went wrong");
        assert_eq!(result.deepest_caused_by, None);
    }

    #[test]
    fn detects_oom() {
        let result = extract_error_sections(
            "ERROR SparkContext: Container killed by YARN for exceeding memory limits",
        );
        assert!(has_cause(&result, "OOM / executors killed", "high"));
    }

    #[test]
    fn detects_access_denied() {
        let result = extract_error_sections(
            "ERROR S3Client: AccessDenied: User is not authorized to perform s3:GetObject",
        );
        assert!(has_cause(&result, "S3/IAM permission denied", "high"));
    }

    #[test]
    fn detects_class_not_found() {
        let result = extract_error_sections(
            "ERROR SparkContext: ClassNotFoundException: com.example.MyClass",
        );
        assert!(has_cause(
            &result,
            "Missing jar or classpath dependency",
            "high"
        ));
    }

    #[test]
    fn detects_parse_exception() {
        let result = extract_error_sections(
            "ERROR SQLExecution: ParseException: mismatched input 'SELECT'",
        );
        assert!(has_cause(&result, "Bad SQL or script syntax", "high"));
    }

    #[test]
    fn detects_cancelled_job() {
        let result = extract_error_sections(
            "ERROR EMRClient: Job cancelled by user, state = CANCELLED",
        );
        assert!(has_cause(&result, "Job cancelled by user", "high"));
    }

    #[test]
    fn detects_script_exit_code_failure() {
        let result = extract_error_sections(
            "ERROR ETLLogger: Script returned exit code 1, command not found: aws",
        );
        assert!(has_cause(&result, "Script exit code failure", "medium"));
    }

    #[test]
    fn detects_disk_space_exhaustion() {
        let result =
            extract_error_sections("ERROR TaskSchedulerImpl: No space left on device");
        assert!(has_cause(&result, "Disk space exhausted", "high"));
    }

    #[test]
    fn extracts_etl_step_ids() {
        let text = concat!(
            "-- stepId=101\n",
            "23/08/01 10:00:02 INFO ETLLogger: Starting ETL step\n",
            "-- stepId=202\n",
            "23/08/01 10:00:03 INFO ETLLogger: Processing records",
        );

        let result = extract_error_sections(text);
        assert!(result.step_ids.contains(&"101".to_string()));
        assert!(result.step_ids.contains(&"202".to_string()));
    }

    #[test]
    fn no_step_ids_without_markers() {
        let result = extract_error_sections("ERROR SparkContext: Job failed");
        assert!(result.step_ids.is_empty());
    }

    const PY_TEXT: &str = concat!(
        "23/08/01 10:00:00 INFO Utils: Running command\n",
        "Traceback (most recent call last):\n",
        "  File \"/usr/lib/spark/python/lib/pyspark.zip/pyspark/worker.py\", line 668, in main\n",
        "    func, profiler, deserializer, serializer = read_command(pickleSer, infile)\n",
        "  File \"user_script.py\", line 42, in transform\n",
        "    raise ValueError(\"bad input row\")\n",
        "ValueError: bad input row\n",
        "23/08/01 10:00:01 INFO SchedulerBackend: Finished processing",
    );

    #[test]
    fn extracts_the_full_python_traceback_block() {
        let result = extract_error_sections(PY_TEXT);
        assert!(!result.tracebacks.is_empty());
        let block = &result.tracebacks[0];
        assert!(block.contains("Traceback (most recent call last):"));
        assert!(block.contains("File \"user_script.py\", line 42"));
        assert!(block.contains("raise ValueError(\"bad input row\")"));
        assert!(block.trim_end().ends_with("ValueError: bad input row"));
    }

    #[test]
    fn python_final_exception_is_the_deepest_cause() {
        let result = extract_error_sections(PY_TEXT);
        assert_eq!(
            result.deepest_caused_by.as_deref(),
            Some("ValueError: bad input row")
        );
    }

    #[test]
    fn python_memory_error_is_high_confidence() {
        let text = concat!(
            "Traceback (most recent call last):\n",
            "  File \"job.py\", line 10, in run\n",
            "    huge = [0] * 10**10\n",
            "MemoryError",
        );
        let result = extract_error_sections(text);
        assert!(has_cause(&result, "Python MemoryError", "high"));
        assert_eq!(result.deepest_caused_by.as_deref(), Some("MemoryError"));
    }

    #[test]
    fn python_exception_lines_reach_the_error_tail() {
        let result = extract_error_sections(PY_TEXT);
        assert!(
            result
                .error_tail
                .contains(&"ValueError: bad input row".to_string())
        );
    }

    const LEVEL_PREFIXED: &str = concat!(
        "23/08/01 10:00:02 ERROR YarnSchedulerBackend: org.apache.spark.SparkException: Job aborted due to stage failure: Task 3 in stage 2 failed 4 times\n",
        "23/08/01 10:00:02 ERROR TaskSetManager: Container killed by YARN for exceeding memory limits",
    );

    #[test]
    fn extracts_an_exception_from_behind_a_log_level_prefix() {
        let result = extract_error_sections(LEVEL_PREFIXED);
        assert!(!result.tracebacks.is_empty());
        assert!(
            result.tracebacks[0].contains("SparkException: Job aborted due to stage failure")
        );
    }

    #[test]
    fn level_prefixed_exception_reaches_the_error_tail() {
        let result = extract_error_sections(LEVEL_PREFIXED);
        assert!(
            result
                .error_tail
                .iter()
                .any(|l| l.contains("SparkException: Job aborted"))
        );
        assert!(
            result
                .error_tail
                .iter()
                .any(|l| l.contains("Container killed by YARN"))
        );
    }

    #[test]
    fn java_caused_by_wins_over_a_python_exception() {
        let mixed = concat!(
            "Traceback (most recent call last):\n",
            "  File \"job.py\", line 10, in run\n",
            "    open(\"/missing\")\n",
            "FileNotFoundError: /missing\n",
            "Exception in thread \"main\" java.lang.RuntimeException: outer\n",
            "Caused by: java.io.IOException: Connection timed out\n",
            "  at java.io.FileInputStream.open0(Native Method)",
        );
        let result = extract_error_sections(mixed);
        assert_eq!(
            result.deepest_caused_by.as_deref(),
            Some("java.io.IOException: Connection timed out")
        );
    }
}
