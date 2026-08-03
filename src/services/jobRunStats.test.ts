import { describe, expect, it } from "vitest";
import type { JobRunSummary } from "@/types/domain";
import {
  aggregateDailyJobCounts,
  aggregateHourlyJobCounts,
  canShiftSelectedDate,
  clampSelectedDate,
  countFailedInLast24Hours,
  countRunningJobs,
  successRatePercent,
  toLocalDateKey
} from "./jobRunStats";

function job(partial: Partial<JobRunSummary> & Pick<JobRunSummary, "id" | "state" | "createdAt">): JobRunSummary {
  return {
    name: partial.name ?? partial.id,
    virtualClusterId: partial.virtualClusterId ?? "vc-1",
    ...partial
  };
}

describe("jobRunStats", () => {
  const now = new Date(2026, 7, 3, 15, 30, 0); // Aug 3 2026 local

  it("aggregates daily success and failed counts across the range including empty days", () => {
    const jobs = [
      job({ id: "1", state: "COMPLETED", createdAt: new Date(2026, 7, 3, 10).toISOString() }),
      job({ id: "2", state: "FAILED", createdAt: new Date(2026, 7, 3, 11).toISOString() }),
      job({ id: "3", state: "COMPLETED", createdAt: new Date(2026, 6, 28, 9).toISOString() }),
      job({ id: "4", state: "RUNNING", createdAt: new Date(2026, 7, 2, 9).toISOString() }),
      job({ id: "5", state: "CANCELLED", createdAt: new Date(2026, 7, 2, 10).toISOString() })
    ];

    const daily = aggregateDailyJobCounts(jobs, now, 7);
    expect(daily).toHaveLength(7);
    expect(daily[0]?.date).toBe(toLocalDateKey(new Date(2026, 6, 28)));
    expect(daily[0]).toMatchObject({ success: 1, failed: 0 });
    expect(daily[daily.length - 1]).toMatchObject({
      date: toLocalDateKey(now),
      success: 1,
      failed: 1
    });
    expect(daily.find((day) => day.date === toLocalDateKey(new Date(2026, 7, 2)))).toMatchObject({
      success: 0,
      failed: 0
    });
  });

  it("aggregates hourly counts for a selected local day", () => {
    const jobs = [
      job({ id: "1", state: "COMPLETED", createdAt: new Date(2026, 7, 3, 2, 15).toISOString() }),
      job({ id: "2", state: "FAILED", createdAt: new Date(2026, 7, 3, 2, 45).toISOString() }),
      job({ id: "3", state: "COMPLETED", createdAt: new Date(2026, 7, 2, 2, 15).toISOString() })
    ];

    const hourly = aggregateHourlyJobCounts(jobs, toLocalDateKey(now));
    expect(hourly).toHaveLength(24);
    expect(hourly[2]).toMatchObject({ hour: 2, success: 1, failed: 1 });
    expect(hourly[0]).toMatchObject({ success: 0, failed: 0 });
  });

  it("computes success rate and returns null when there are no terminal jobs", () => {
    const jobs = [
      job({ id: "1", state: "COMPLETED", createdAt: new Date(2026, 7, 1).toISOString() }),
      job({ id: "2", state: "FAILED", createdAt: new Date(2026, 7, 2).toISOString() }),
      job({ id: "3", state: "RUNNING", createdAt: new Date(2026, 7, 3).toISOString() })
    ];
    expect(successRatePercent(jobs, now, 7)).toBe(50);
    expect(successRatePercent([], now, 7)).toBeNull();
  });

  it("counts running jobs and rolling 24h failures", () => {
    const jobs = [
      job({ id: "1", state: "RUNNING", createdAt: new Date(2026, 7, 1).toISOString() }),
      job({ id: "2", state: "FAILED", createdAt: new Date(2026, 7, 3, 10).toISOString() }),
      job({ id: "3", state: "FAILED", createdAt: new Date(2026, 7, 1, 10).toISOString() })
    ];
    expect(countRunningJobs(jobs)).toBe(1);
    expect(countFailedInLast24Hours(jobs, now)).toBe(1);
  });

  it("clamps selected date into the active range window", () => {
    expect(clampSelectedDate("2026-07-01", now, 7)).toBe(toLocalDateKey(now));
    expect(clampSelectedDate(toLocalDateKey(new Date(2026, 7, 1)), now, 7)).toBe(
      toLocalDateKey(new Date(2026, 7, 1))
    );
    expect(canShiftSelectedDate(toLocalDateKey(now), 1, now, 7)).toBe(false);
    expect(canShiftSelectedDate(toLocalDateKey(now), -1, now, 7)).toBe(true);
  });
});
