import type { JobState } from "@/types/domain";

const inFlightJobStates = new Set<JobState>(["PENDING", "SUBMITTED", "RUNNING"]);

/** Job states that should keep Submit Job auto-refresh running. */
export function isInFlightJobState(state: JobState | string) {
  return inFlightJobStates.has(state as JobState);
}

export function submissionHistorySettled(jobs: Array<{ state: JobState | string }>) {
  if (jobs.length === 0) return false;
  return !jobs.some((job) => isInFlightJobState(job.state));
}
