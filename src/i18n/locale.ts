import type { LanguagePreference } from "@/services/languagePreferences";
import type { EffectiveLocale } from "@/i18n/types";

/** Matches zh, zh-CN, zh_CN, zh-Hans, zh-Hans-CN, zh-TW, zh-Hant-HK. */
const CHINESE_TAG = /^zh([-_]|$)/i;

export function normalizeLocaleTag(tag: string | null | undefined): EffectiveLocale {
  if (!tag) return "en";
  return CHINESE_TAG.test(tag.trim()) ? "zh" : "en";
}

/**
 * Only the user's top preference is honoured. Scanning the whole list would give
 * Chinese to a user whose list is ["en-US", "zh-CN"], which is not what the OS
 * means by ordering it that way.
 */
export function resolveSystemLocale(): EffectiveLocale {
  if (typeof navigator === "undefined") return "en";
  return normalizeLocaleTag(navigator.languages?.[0] ?? navigator.language);
}

export function resolveEffectiveLocale(preference: LanguagePreference): EffectiveLocale {
  return preference === "system" ? resolveSystemLocale() : preference;
}

/** The BCP-47 tag passed to `Intl` and to the native menu. */
export function localeTag(locale: EffectiveLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}
