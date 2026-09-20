import { dictionaries } from "@/i18n/locales";
import { interpolate } from "@/i18n/interpolate";
import { getEffectiveLocale } from "@/i18n/store";
import type { EffectiveLocale, InterpolationVars } from "@/i18n/types";

/**
 * English is the key itself: there is no `en` dictionary and no missing-key
 * fallback path, so an untranslated string renders as its English source.
 */
function lookup(key: string, locale: EffectiveLocale) {
  return dictionaries[locale]?.[key] ?? key;
}

export function translate(key: string, vars: InterpolationVars | undefined, locale: EffectiveLocale) {
  return interpolate(lookup(key, locale), vars);
}

export function createTranslator(locale: EffectiveLocale) {
  return (key: string, vars?: InterpolationVars) => translate(key, vars, locale);
}

/** Callable from React and from plain modules (CodeMirror panels, services). */
export function t(key: string, vars?: InterpolationVars) {
  return translate(key, vars, getEffectiveLocale());
}
