const autoUpdateStorageKey = "emr-eks:auto-update";

/** Whether the app should silently check for and install updates on launch. Defaults to on. */
export function readAutoUpdatePreference() {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(autoUpdateStorageKey);
    if (stored === null) return true;
    return stored === "true";
  } catch {
    return true;
  }
}

export function writeAutoUpdatePreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(autoUpdateStorageKey, String(enabled));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}
