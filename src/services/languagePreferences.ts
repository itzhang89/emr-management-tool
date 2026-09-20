const languageStorageKey = "emr-eks:language";

/** Which language the interface renders in. `"system"` follows the OS locale. */
export type LanguagePreference = "system" | "zh" | "en";

const languagePreferences: LanguagePreference[] = ["system", "zh", "en"];

function isLanguagePreference(value: string): value is LanguagePreference {
  return (languagePreferences as string[]).includes(value);
}

export function readLanguagePreference(): LanguagePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(languageStorageKey);
    if (stored === null || !isLanguagePreference(stored)) return "system";
    return stored;
  } catch {
    return "system";
  }
}

export function writeLanguagePreference(value: LanguagePreference) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(languageStorageKey, value);
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}
