import { describe, expect, it } from "vitest";
import {
  readJobHistoryAutoRefreshPreference,
  writeJobHistoryAutoRefreshPreference
} from "@/services/jobHistoryPreferences";
import { isInFlightJobState, submissionHistorySettled } from "@/services/jobRunState";

describe("jobHistoryPreferences", () => {
  it("defaults job history auto refresh to enabled", () => {
    localStorage.clear();
    expect(readJobHistoryAutoRefreshPreference()).toBe(true);
  });

  it("persists job history auto refresh preference", () => {
    localStorage.clear();
    writeJobHistoryAutoRefreshPreference(false);
    expect(readJobHistoryAutoRefreshPreference()).toBe(false);
    writeJobHistoryAutoRefreshPreference(true);
    expect(readJobHistoryAutoRefreshPreference()).toBe(true);
  });
});

describe("jobRunState", () => {
  it("treats pending, submitted, and running as in-flight", () => {
    expect(isInFlightJobState("PENDING")).toBe(true);
    expect(isInFlightJobState("SUBMITTED")).toBe(true);
    expect(isInFlightJobState("RUNNING")).toBe(true);
    expect(isInFlightJobState("COMPLETED")).toBe(false);
    expect(isInFlightJobState("FAILED")).toBe(false);
  });

  it("considers submission history settled when no in-flight jobs remain", () => {
    expect(submissionHistorySettled([])).toBe(false);
    expect(
      submissionHistorySettled([
        { state: "RUNNING" },
        { state: "COMPLETED" }
      ])
    ).toBe(false);
    expect(
      submissionHistorySettled([
        { state: "COMPLETED" },
        { state: "FAILED" }
      ])
    ).toBe(true);
  });
});
