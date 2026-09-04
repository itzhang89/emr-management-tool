import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAutoUpdatePreference, writeAutoUpdatePreference } from "./autoUpdatePreferences";

const storageKey = "emr-eks:auto-update";

describe("autoUpdatePreferences", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("defaults automatic updates to on when nothing is stored", () => {
    expect(readAutoUpdatePreference()).toBe(true);
  });

  it("persists a disabled choice and reads it back", () => {
    writeAutoUpdatePreference(false);
    expect(window.localStorage.getItem(storageKey)).toBe("false");
    expect(readAutoUpdatePreference()).toBe(false);
  });

  it("round-trips a re-enabled choice", () => {
    writeAutoUpdatePreference(false);
    writeAutoUpdatePreference(true);
    expect(window.localStorage.getItem(storageKey)).toBe("true");
    expect(readAutoUpdatePreference()).toBe(true);
  });
});
