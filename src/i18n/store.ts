import {
  readLanguagePreference,
  writeLanguagePreference,
  type LanguagePreference
} from "@/services/languagePreferences";
import { resolveEffectiveLocale } from "@/i18n/locale";
import type { EffectiveLocale } from "@/i18n/types";

let preference: LanguagePreference | undefined;
let effectiveLocale: EffectiveLocale | undefined;
const listeners = new Set<() => void>();

/**
 * Lazy rather than at module scope: reading `window` during import is a hazard
 * under SSR, and a value cached at import time would leak across tests that
 * clear local storage between cases.
 */
function initialize() {
  if (preference === undefined || effectiveLocale === undefined) {
    preference = readLanguagePreference();
    effectiveLocale = resolveEffectiveLocale(preference);
  }
}

export function getLanguagePreference(): LanguagePreference {
  initialize();
  return preference!;
}

export function getEffectiveLocale(): EffectiveLocale {
  initialize();
  return effectiveLocale!;
}

export function setLanguagePreference(value: LanguagePreference) {
  initialize();
  const preferenceChanged = preference !== value;
  preference = value;
  writeLanguagePreference(value);

  const next = resolveEffectiveLocale(value);
  const localeChanged = next !== effectiveLocale;
  effectiveLocale = next;

  if (preferenceChanged || localeChanged) {
    for (const listener of [...listeners]) listener();
  }
}

export function subscribeToLanguage(listener: () => void) {
  initialize();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
