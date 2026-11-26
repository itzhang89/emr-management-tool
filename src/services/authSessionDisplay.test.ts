import { describe, expect, it } from "vitest";
import { formatRemainingDuration, getSessionRemaining } from "./authSessionDisplay";

describe("formatRemainingDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatRemainingDuration(11 * 3600_000 + 42 * 60_000)).toBe("11h 42m");
    expect(formatRemainingDuration(2 * 3600_000)).toBe("2h");
  });

  it("formats short durations", () => {
    expect(formatRemainingDuration(9 * 60_000 + 12_000)).toBe("9m 12s");
    expect(formatRemainingDuration(45_000)).toBe("45s");
  });
});

describe("getSessionRemaining", () => {
  const now = Date.parse("2026-11-17T02:00:00.000Z");

  it("returns null without an expiry", () => {
    expect(getSessionRemaining(undefined, now)).toBeNull();
  });

  it("marks expired sessions", () => {
    expect(getSessionRemaining("2026-11-17T01:59:00.000Z", now)).toEqual({
      msLeft: 0,
      tone: "expired",
      durationLabel: ""
    });
  });

  it("warns when fewer than 10 minutes remain", () => {
    const remaining = getSessionRemaining("2026-11-17T02:08:00.000Z", now);
    expect(remaining?.tone).toBe("warn");
    expect(remaining?.durationLabel).toBe("8m");
  });

  it("reports longer sessions as ok", () => {
    const remaining = getSessionRemaining("2026-11-17T14:00:00.000Z", now);
    expect(remaining?.tone).toBe("ok");
    expect(remaining?.durationLabel).toBe("12h");
  });
});
