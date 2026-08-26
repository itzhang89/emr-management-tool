/**
 * Failure analysis extractor.
 *
 * Given simplified log text, extract:
 * - Traceback blocks (Caused by:, Exception in thread, stack frames)
 * - ETL stepId markers for step context
 * - Heuristic candidate causes matched from known patterns
 */

export interface ExtractedErrorSection {
  /** Last N ERROR/WARN lines */
  errorTail: string[];
  /** Extracted Spark traceback blocks (deepest Caused by first) */
  tracebacks: string[];
  /** Deepest Caused-by chain (the most likely root cause) */
  deepestCausedBy: string | null;
  /** ETL step IDs found in the log */
  stepIds: string[];
  /** Candidate root causes */
  candidateCauses: CandidateCause[];
}

export interface CandidateCause {
  cause: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

const STEP_ID_RE = /^-- stepId=(\d+)\s*$/;
const CAUSED_BY_RE = /^Caused by:\s*(.+)$/;
const EXCEPTION_RE = /^(Exception in thread "[^"]+"|.+Exception|.+Error|.+Throwable)/;
const STACK_FRAME_RE = /^\s+at\s+.+\(.+\)$/;
const ELLIPSIS_RE = /^\.\.\. \d+ more$/;

const CAUSE_PATTERNS: Array<{
  pattern: RegExp;
  cause: string;
  confidence: CandidateCause["confidence"];
}> = [
  // OOM / memory
  { pattern: /OutOfMemoryError|Container killed by YARN|Memory limit exceeded|Killed\s+(due to|by)/i, cause: "OOM / executors killed", confidence: "high" },
  { pattern: /Container\s+\S+\s+is\s+RUNNING\s+but\s+not\s+responding/i, cause: "Executor lost / container stuck", confidence: "medium" },

  // Permission / IAM
  { pattern: /AccessDenied|Permission denied|NoSuchBucket|AccessDeniedException/i, cause: "S3/IAM permission denied", confidence: "high" },
  { pattern: /User:\s+arn:aws:sts::\d{12}:assumed-role\/\S+is not authorized/i, cause: "IAM role not authorized", confidence: "high" },

  // Missing class / jar
  { pattern: /ClassNotFoundException|NoClassDefFoundError|No such file or class/i, cause: "Missing jar or classpath dependency", confidence: "high" },
  { pattern: /MethodNotFound|NoSuchMethodError/i, cause: "Version mismatch / incompatible API", confidence: "medium" },

  // Bad SQL / script
  { pattern: /ParseException|AnalysisException|mismatched input|InvalidInputException/i, cause: "Bad SQL or script syntax", confidence: "high" },
  { pattern: /Table not found|View not found|Database.*not found|Relation.*not found/i, cause: "Missing table or view in SQL", confidence: "high" },
  { pattern: /Column.*not found|Cannot resolve/i, cause: "Missing column in SQL query", confidence: "high" },

  // Stage failure
  { pattern: /SparkException.*Job aborted|Stage failed|Task failed/i, cause: "Spark stage failure", confidence: "medium" },
  { pattern: /Shuffle.*failed|Shuffle.*error/i, cause: "Shuffle failure (data skew / partition issue)", confidence: "medium" },

  // Script exit
  { pattern: /command not found|Non-zero exit|Script returned exit code|Exit code/i, cause: "Script exit code failure", confidence: "medium" },

  // Cancelled
  { pattern: /CANCELLED|CancelJobRun|Job run cancelled/i, cause: "Job cancelled by user", confidence: "high" },

  // Resource / throttle
  { pattern: /Throttling|Rate exceeded|LimitExceeded|TooManyRequests/i, cause: "AWS API throttling / rate limit", confidence: "medium" },
  { pattern: /Timed out|Timeout|timedout/i, cause: "Operation timed out", confidence: "medium" },
  { pattern: /No space left|Disk quota|DiskFull/i, cause: "Disk space exhausted", confidence: "high" },
];

export function extractErrorSections(simplifiedText: string): ExtractedErrorSection {
  if (!simplifiedText) {
    return { errorTail: [], tracebacks: [], deepestCausedBy: null, stepIds: [], candidateCauses: [] };
  }

  const lines = simplifiedText.split("\n");
  const errorTail: string[] = [];
  const tracebacks: string[] = [];
  const stepIds: string[] = [];
  const allErrors: string[] = [];

  // Collect error lines and traceback blocks
  let currentTraceback: string[] | null = null;

  for (const line of lines) {
    const isError = line.includes("ERROR") || line.includes("WARN");
    const isCausedBy = CAUSED_BY_RE.test(line);
    const isException = EXCEPTION_RE.test(line);
    const isStackFrame = STACK_FRAME_RE.test(line);
    const isEllipsis = ELLIPSIS_RE.test(line);

    // Check for ETL step markers
    const stepMatch = line.match(STEP_ID_RE);
    if (stepMatch) {
      stepIds.push(stepMatch[1]!);
    }

    // Track traceback blocks
    if (isException || isCausedBy) {
      if (currentTraceback === null) {
        currentTraceback = [];
      }
      currentTraceback.push(line);
      allErrors.push(line);
    } else if (isStackFrame || isEllipsis) {
      if (currentTraceback !== null) {
        currentTraceback.push(line);
      }
    } else {
      if (currentTraceback !== null && currentTraceback.length > 1) {
        tracebacks.push(currentTraceback.join("\n"));
      }
      currentTraceback = null;
    }

    // Collect error/warn lines for the tail
    if (isError && !isStackFrame && !isEllipsis) {
      allErrors.push(line);
    }
  }

  // Flush last traceback
  if (currentTraceback !== null && currentTraceback.length > 1) {
    tracebacks.push(currentTraceback.join("\n"));
  }

  // Last 30 error lines for the tail
  const lastN = allErrors.slice(-30);
  errorTail.push(...lastN);

  // Find deepest Caused by (last one in the log)
  const causedByLines = allErrors
    .map((l) => l.match(CAUSED_BY_RE))
    .filter(Boolean)
    .map((m) => m![1]!);
  const deepestCausedBy = causedByLines.length > 0 ? causedByLines[causedByLines.length - 1] : null;

  // Match candidate causes
  const candidateCauses = matchCauses(allErrors);

  return { errorTail, tracebacks, deepestCausedBy, stepIds, candidateCauses };
}

function matchCauses(lines: string[]): CandidateCause[] {
  const matched = new Set<string>();
  const causes: CandidateCause[] = [];

  for (const line of lines) {
    for (const cp of CAUSE_PATTERNS) {
      if (matched.has(cp.cause)) continue;
      const match = line.match(cp.pattern);
      if (match) {
        matched.add(cp.cause);
        causes.push({
          cause: cp.cause,
          confidence: cp.confidence,
          evidence: line.trim().slice(0, 200),
        });
      }
    }
  }

  return causes;
}