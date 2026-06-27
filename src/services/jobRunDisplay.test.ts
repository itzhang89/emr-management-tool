import { describe, expect, it } from "vitest";
import { formatJobRunDuration } from "./jobRunDisplay";
import type { JobRunSummary } from "@/types/domain";

describe("formatJobRunDuration", () => {
  it("formats seconds only", () => {
    expect(formatJobRunDuration(makeJob({ durationSeconds: 45 }))).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatJobRunDuration(makeJob({ durationSeconds: 125 }))).toBe("2m 5s");
  });

  it("returns dash when duration is unavailable", () => {
    expect(formatJobRunDuration(makeJob({}))).toBe("-");
  });
});

function makeJob(overrides: Partial<JobRunSummary>): JobRunSummary {
  return {
    id: "job-1",
    name: "sample",
    state: "SUCCEEDED",
    virtualClusterId: "vc-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}
