import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLanguagePreference, writeLanguagePreference } from "./languagePreferences";

const storageKey = "emr-eks:language";

describe("languagePreferences", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("follows the system language when nothing is stored", () => {
    expect(readLanguagePreference()).toBe("system");
  });

  it("persists each supported choice and reads it back", () => {
    for (const preference of ["zh", "en", "system"] as const) {
      writeLanguagePreference(preference);
      expect(window.localStorage.getItem(storageKey)).toBe(preference);
      expect(readLanguagePreference()).toBe(preference);
    }
  });

  it("falls back to the system language for an unrecognized stored value", () => {
    window.localStorage.setItem(storageKey, "fr");
    expect(readLanguagePreference()).toBe("system");
  });
});
