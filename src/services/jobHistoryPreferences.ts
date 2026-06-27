const jobHistoryAutoRefreshStorageKey = "emr-eks:job-history-auto-refresh";

export function readJobHistoryAutoRefreshPreference() {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(jobHistoryAutoRefreshStorageKey);
    if (stored === null) return true;
    return stored === "true";
  } catch {
    return true;
  }
}

export function writeJobHistoryAutoRefreshPreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(jobHistoryAutoRefreshStorageKey, String(enabled));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

/** @deprecated Use readJobHistoryAutoRefreshPreference */
export const readAutoRefreshPreference = readJobHistoryAutoRefreshPreference;

/** @deprecated Use writeJobHistoryAutoRefreshPreference */
export const writeAutoRefreshPreference = writeJobHistoryAutoRefreshPreference;
