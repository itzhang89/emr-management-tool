import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBetaUpdatePreference, writeBetaUpdatePreference } from "./updateChannelPreferences";

const storageKey = "emr-eks:beta-updates";

describe("updateChannelPreferences", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("defaults beta updates to off when nothing is stored", () => {
    expect(readBetaUpdatePreference()).toBe(false);
  });

  it("persists an opted-in choice and reads it back", () => {
    writeBetaUpdatePreference(true);
    expect(window.localStorage.getItem(storageKey)).toBe("true");
    expect(readBetaUpdatePreference()).toBe(true);
  });

  it("round-trips opting back out", () => {
    writeBetaUpdatePreference(true);
    writeBetaUpdatePreference(false);
    expect(window.localStorage.getItem(storageKey)).toBe("false");
    expect(readBetaUpdatePreference()).toBe(false);
  });

  it("treats a non-boolean stored value as opted out", () => {
    window.localStorage.setItem(storageKey, "yes");
    expect(readBetaUpdatePreference()).toBe(false);
  });
});
