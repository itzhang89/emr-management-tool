import { describe, expect, it } from "vitest";
import { keyboardShortcuts, shortcutCategories } from "@/data/keyboardShortcuts";
import { zh } from "@/i18n/locales/zh";
import { navigationItems } from "@/pages/pageMeta";

/**
 * `src/data/keyboardShortcuts.ts` and `src/pages/pageMeta.ts` stay plain English
 * data modules (their own tests assert on those source strings), so their labels
 * are transcribed by hand into the dictionary. This is the guard against that
 * transcription drifting.
 */
const IDENTITY_KEYS = new Set(["DBHub"]);

function expectTranslated(source: string) {
  if (IDENTITY_KEYS.has(source)) return;
  expect(zh[source], `no zh entry for "${source}"`).toBeDefined();
  expect(zh[source], `zh entry for "${source}" is untranslated`).not.toBe(source);
}

describe("zh dictionary coverage", () => {
  it("translates every navigation item", () => {
    for (const item of navigationItems) {
      expectTranslated(item.label);
      expectTranslated(item.description);
    }
  });

  it("translates every shortcut category", () => {
    for (const category of shortcutCategories) {
      expectTranslated(category.label);
      if (category.description) expectTranslated(category.description);
    }
  });

  it("translates every keyboard shortcut", () => {
    for (const shortcut of keyboardShortcuts) {
      expectTranslated(shortcut.label);
      expectTranslated(shortcut.description);
    }
  });

  it("has no empty translations", () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), `empty zh entry for "${key}"`).not.toBe("");
    }
  });
});
