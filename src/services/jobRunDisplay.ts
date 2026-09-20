import type { JobRunSummary } from "@/types/domain";

export function formatJobRunDuration(job: JobRunSummary) {
  const seconds = job.durationSeconds ?? durationFromTimestamps(job);
  if (!seconds || seconds < 0) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Job names are routinely stamped with the submission time —
 * `job_name_260920_0735`. In a tab strip that tail eats the
 * room the distinguishing part of the name needs, and since every run carries
 * one, they all truncate to the same unreadable prefix. The stamp is dropped
 * from the *label* only; the full name stays on the tab as its tooltip.
 *
 * Only a trailing `_<6 or 8 digit date>_<4 digit time>` counts as a stamp. A
 * name that is nothing but a stamp keeps it — there would be nothing left.
 */
export function stripJobNameTimestamp(name: string) {
  const stripped = name.replace(/[_-]\d{6,8}[_-]\d{4}$/, "");
  return stripped.trim().length > 0 ? stripped : name;
}

function durationFromTimestamps(job: JobRunSummary) {
  const start = Date.parse(job.startedAt ?? job.createdAt);
  const end = Date.parse(job.finishedAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, Math.round((end - start) / 1000));
}
