/** Keep in sync with repository::SUBMISSION_HISTORY_LIMIT in src-tauri. */
export const SUBMISSION_HISTORY_LIMIT = 20;

export const JOB_HISTORY_PAGE_SIZE = 10;

export const JOB_HISTORY_REFRESH_INTERVAL_MS = 15_000;

export const JOB_HISTORY_REFRESH_INTERVAL_SECONDS = JOB_HISTORY_REFRESH_INTERVAL_MS / 1_000;

/** Pause auto-refresh after AWS throttling before the next attempt. */
export const AWS_THROTTLE_PAUSE_MS = 60_000;
