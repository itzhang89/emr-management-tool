/** The concrete language the interface renders in, after resolving `"system"`. */
export type EffectiveLocale = "zh" | "en";

/** Values substituted into `{placeholder}` slots. */
export type InterpolationVars = Record<string, string | number>;

/**
 * A translator bound to one locale. Passed into module-scope render helpers,
 * which cannot call hooks themselves.
 */
export type Translator = (key: string, vars?: InterpolationVars) => string;

/**
 * Maps an English source string to its translation. English needs no dictionary:
 * the key *is* the English string, so a missing entry degrades to English rather
 * than to a bare key.
 */
export type TranslationDictionary = Record<string, string>;
