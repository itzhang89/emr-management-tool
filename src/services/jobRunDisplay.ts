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

function durationFromTimestamps(job: JobRunSummary) {
  const start = Date.parse(job.startedAt ?? job.createdAt);
  const end = Date.parse(job.finishedAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, Math.round((end - start) / 1000));
}
