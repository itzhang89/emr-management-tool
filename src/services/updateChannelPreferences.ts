const betaUpdatesStorageKey = "emr-eks:beta-updates";

/**
 * Whether the app should consult the beta channel when checking for updates.
 * Defaults to off: betas are opt-in, and a stable install must not drift onto
 * prereleases on its own.
 */
export function readBetaUpdatePreference() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(betaUpdatesStorageKey) === "true";
  } catch {
    return false;
  }
}

export function writeBetaUpdatePreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(betaUpdatesStorageKey, String(enabled));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}
