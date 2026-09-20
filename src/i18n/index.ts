/**
 * Public i18n surface. React components and other browser code should import
 * from here; plain modules that must not pull React into their import graph
 * (CodeMirror panels, services) can import `t` from `@/i18n/translate`.
 */
export { createTranslator, t, translate } from "@/i18n/translate";
export { useLocale, useLanguagePreference, useT } from "@/i18n/useT";
export {
  getEffectiveLocale,
  getLanguagePreference,
  setLanguagePreference,
  subscribeToLanguage
} from "@/i18n/store";
export { localeTag, normalizeLocaleTag, resolveEffectiveLocale, resolveSystemLocale } from "@/i18n/locale";
export type { EffectiveLocale, InterpolationVars, TranslationDictionary, Translator } from "@/i18n/types";
