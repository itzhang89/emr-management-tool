import { describe, expect, it } from "vitest";
import { formatJobRunDuration, stripJobNameTimestamp } from "./jobRunDisplay";
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
    state: "COMPLETED",
    virtualClusterId: "vc-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("stripJobNameTimestamp", () => {
  it("drops a trailing date-time stamp", () => {
    expect(stripJobNameTimestamp("job_name_260920_0735")).toBe(
      "job_name"
    );
    expect(stripJobNameTimestamp("nightly-etl-20260920-0735")).toBe("nightly-etl");
  });

  it("leaves a name that has no stamp alone", () => {
    expect(stripJobNameTimestamp("nightly-etl")).toBe("nightly-etl");
    expect(stripJobNameTimestamp("g2_5mins_latest_only")).toBe("g2_5mins_latest_only");
    // A bare date is not a stamp: the time has to sit beside it.
    expect(stripJobNameTimestamp("report_260920")).toBe("report_260920");
  });

  it("keeps a name that stripping would empty", () => {
    expect(stripJobNameTimestamp("260920_0735")).toBe("260920_0735");
  });
});
