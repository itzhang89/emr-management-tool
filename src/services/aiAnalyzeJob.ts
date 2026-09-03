/**
 * Turning a failed job on the Job History page into a Chat analysis: a stable
 * conversation title derived from the job's name, and the question to send.
 *
 * A job rerun keeps the logical name but appends a timestamp/date of the run
 * (or an AWS-style suffix), so if we titled conversations by the raw name every
 * rerun would get its own conversation. These helpers strip that trailing run
 * marker so repeated attempts of the same job land in one conversation, which is
 * then reused (its context cleared) on the next Analyze click.
 */

export interface JobAnalyzeIntent {
  jobId: string;
  jobName?: string;
  virtualClusterId?: string;
}

// A trailing run suffix, after a separator: a full date (optionally with a time
// in several spellings — "2026-08-31", "2026-08-31T03-00-00Z", "2026-08-31 03:00:00",
// "2026-08-31-030000"), a compact digit run like an epoch seconds / yyyyMMdd
// timestamp ("1693456789", "20260831", "20260831_030000"), or a shorthand yyMMdd
// date with an optional time ("_260903", "_260903_0245"). Anchored at the end and
// reapplied until nothing more falls off, so stacked spellings all reduce the name
// to its logical part.
const FULL_DATE_SUFFIX =
  "\\d{4}[-_.\\/]\\d{1,2}[-_.\\/]\\d{1,2}(?:[Tt _-]\\d{1,2}(?:[:._-]?\\d{1,2}){1,2}(?:Z|UTC)?)?";
// Listed before the shorthand date so "20260831" is read as a compact timestamp,
// not as a yyMMdd date that would leave "31" behind.
const COMPACT_SUFFIX = "\\d{8,14}(?:[-_.~]\\d{1,6})*";
const SHORT_DATE_SUFFIX = "\\d{6}(?:[Tt _-]\\d{1,6})?";
const TRAILING_RUN_SUFFIX = new RegExp(
  `(?:\\s*[-_~]\\s*|\\s+)(?:${FULL_DATE_SUFFIX}|${COMPACT_SUFFIX}|${SHORT_DATE_SUFFIX})\\s*$`
);

/**
 * Job name → conversation title. Strips trailing date/time run markers; a name
 * with no marker (or one that would become empty) is returned trimmed.
 */
export function jobSessionTitle(jobName?: string): string {
  const name = (jobName ?? "").trim();
  if (!name) return "";
  let previous = "";
  let current = name;
  while (current !== previous) {
    previous = current;
    current = current.replace(TRAILING_RUN_SUFFIX, "").trim();
  }
  return current || name;
}

/** Whether a session's title is the same analyzed job as `title`. */
export function sameJobTitle(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The question the assistant is sent for a failed job. */
export function jobAnalysisPrompt(intent: JobAnalyzeIntent): string {
  const location = intent.virtualClusterId
    ? ` It ran in virtual cluster ${intent.virtualClusterId}.`
    : "";
  return (
    `Job ${intent.jobId} failed. Find out why it failed and explain the root cause.` +
    `${location} Locate the job across my accounts and inspect its controller and driver logs as needed.`
  );
}
