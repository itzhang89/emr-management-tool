const autoRefreshStorageKey = "emr-eks:job-history-auto-refresh";

export function readAutoRefreshPreference() {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(autoRefreshStorageKey);
    if (stored === null) return true;
    return stored === "true";
  } catch {
    return true;
  }
}

export function writeAutoRefreshPreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(autoRefreshStorageKey, String(enabled));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}
