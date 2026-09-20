import { zh } from "@/i18n/locales/zh";
import type { EffectiveLocale, TranslationDictionary } from "@/i18n/types";

/** English needs no dictionary: the key is the English source string. */
export const dictionaries: Partial<Record<EffectiveLocale, TranslationDictionary>> = { zh };
