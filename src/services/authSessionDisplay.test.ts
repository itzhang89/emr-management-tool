import { describe, expect, it } from "vitest";
import {
  canSilentRefresh,
  formatRemainingDuration,
  getSessionRemaining,
  needsInteractiveMfaRefresh,
  shouldProactivelyRefresh
} from "./authSessionDisplay";

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

  it("flags proactive refresh near expiry", () => {
    expect(shouldProactivelyRefresh("2026-11-17T02:08:00.000Z", now)).toBe(true);
    expect(shouldProactivelyRefresh("2026-11-17T14:00:00.000Z", now)).toBe(false);
  });
});

describe("refresh capability helpers", () => {
  it("allows silent refresh for SSO and AssumeRole without MFA", () => {
    expect(canSilentRefresh({ authMethod: "sso" })).toBe(true);
    expect(canSilentRefresh({ authMethod: "assumeRole" })).toBe(true);
    expect(canSilentRefresh({ authMethod: "assumeRole", mfaSerial: "arn:aws:iam::1:mfa/u" })).toBe(
      false
    );
    expect(canSilentRefresh({ authMethod: "mfaSession" })).toBe(false);
  });

  it("requires interactive MFA for MFA session and AssumeRole with MFA", () => {
    expect(needsInteractiveMfaRefresh({ authMethod: "mfaSession" })).toBe(true);
    expect(
      needsInteractiveMfaRefresh({ authMethod: "assumeRole", mfaSerial: "arn:aws:iam::1:mfa/u" })
    ).toBe(true);
    expect(needsInteractiveMfaRefresh({ authMethod: "sso" })).toBe(false);
  });
});
