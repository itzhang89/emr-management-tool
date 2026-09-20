import { useMemo, useSyncExternalStore } from "react";
import { getEffectiveLocale, getLanguagePreference, subscribeToLanguage } from "@/i18n/store";
import { createTranslator } from "@/i18n/translate";
import type { LanguagePreference } from "@/services/languagePreferences";
import type { EffectiveLocale } from "@/i18n/types";

/** Server snapshot: the tests and any non-browser render resolve to English. */
const serverLocale = "en" as const;
const serverPreference = "system" as const;

export function useLocale(): EffectiveLocale {
  return useSyncExternalStore(subscribeToLanguage, getEffectiveLocale, () => serverLocale);
}

export function useLanguagePreference(): LanguagePreference {
  return useSyncExternalStore(subscribeToLanguage, getLanguagePreference, () => serverPreference);
}

/**
 * A translator bound to the current locale. The returned function identity
 * changes with the locale, so downstream `useMemo`/`useCallback` that depend on
 * it recompute correctly.
 */
export function useT() {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
