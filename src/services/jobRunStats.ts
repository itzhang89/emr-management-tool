import {
  addDays,
  eachDayOfInterval,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  subDays
} from "date-fns";
import type { JobRunSummary } from "@/types/domain";

export type StatsRangeDays = 7 | 15 | 30;

export interface JobCountBucket {
  success: number;
  failed: number;
}

export interface DailyJobCount extends JobCountBucket {
  /** Local calendar date key yyyy-MM-dd */
  date: string;
  label: string;
}

export interface HourlyJobCount extends JobCountBucket {
  hour: number;
  label: string;
}

export const STATS_RANGE_OPTIONS: StatsRangeDays[] = [7, 15, 30];

export function toLocalDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseLocalDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return startOfDay(new Date(year, month - 1, day));
}

export function rangeStartDate(now: Date, rangeDays: StatsRangeDays): Date {
  return startOfDay(subDays(now, rangeDays - 1));
}

export function clampSelectedDate(
  selectedDate: string,
  now: Date,
  rangeDays: StatsRangeDays
): string {
  const start = rangeStartDate(now, rangeDays);
  const end = startOfDay(now);
  const selected = parseLocalDateKey(selectedDate);
  if (selected < start || selected > end) {
    return toLocalDateKey(end);
  }
  return selectedDate;
}

function isTerminalSuccessOrFailed(job: JobRunSummary): job is JobRunSummary & {
  state: "COMPLETED" | "FAILED";
} {
  return job.state === "COMPLETED" || job.state === "FAILED";
}

export function aggregateDailyJobCounts(
  jobs: JobRunSummary[],
  now: Date,
  rangeDays: StatsRangeDays
): DailyJobCount[] {
  const start = rangeStartDate(now, rangeDays);
  const end = startOfDay(now);
  const days = eachDayOfInterval({ start, end });
  const buckets = new Map<string, JobCountBucket>();
  for (const day of days) {
    buckets.set(toLocalDateKey(day), { success: 0, failed: 0 });
  }

  for (const job of jobs) {
    if (!isTerminalSuccessOrFailed(job)) continue;
    const created = parseISO(job.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const key = toLocalDateKey(created);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (job.state === "COMPLETED") bucket.success += 1;
    else bucket.failed += 1;
  }

  return days.map((day) => {
    const date = toLocalDateKey(day);
    const bucket = buckets.get(date) ?? { success: 0, failed: 0 };
    return {
      date,
      label: format(day, "MMM d"),
      success: bucket.success,
      failed: bucket.failed
    };
  });
}

export function aggregateHourlyJobCounts(
  jobs: JobRunSummary[],
  selectedDate: string
): HourlyJobCount[] {
  const day = parseLocalDateKey(selectedDate);
  const buckets = Array.from({ length: 24 }, () => ({ success: 0, failed: 0 }));

  for (const job of jobs) {
    if (!isTerminalSuccessOrFailed(job)) continue;
    const created = parseISO(job.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    if (!isSameDay(created, day)) continue;
    const hour = created.getHours();
    if (job.state === "COMPLETED") buckets[hour].success += 1;
    else buckets[hour].failed += 1;
  }

  return buckets.map((bucket, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    success: bucket.success,
    failed: bucket.failed
  }));
}

export function countRunningJobs(jobs: JobRunSummary[]): number {
  return jobs.filter((job) => job.state === "RUNNING").length;
}

export function successRatePercent(
  jobs: JobRunSummary[],
  now: Date,
  rangeDays: StatsRangeDays
): number | null {
  const start = rangeStartDate(now, rangeDays);
  const endExclusive = addDays(startOfDay(now), 1);
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    if (!isTerminalSuccessOrFailed(job)) continue;
    const created = parseISO(job.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    if (created < start || created >= endExclusive) continue;
    if (job.state === "COMPLETED") completed += 1;
    else failed += 1;
  }

  const total = completed + failed;
  if (total === 0) return null;
  return Math.round((completed / total) * 1000) / 10;
}

export function countFailedInLast24Hours(jobs: JobRunSummary[], now: Date): number {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  return jobs.filter((job) => {
    if (job.state !== "FAILED") return false;
    const created = Date.parse(job.createdAt);
    return !Number.isNaN(created) && created >= cutoff;
  }).length;
}

export function shiftLocalDateKey(dateKey: string, deltaDays: number): string {
  return toLocalDateKey(addDays(parseLocalDateKey(dateKey), deltaDays));
}

export function canShiftSelectedDate(
  selectedDate: string,
  deltaDays: number,
  now: Date,
  rangeDays: StatsRangeDays
): boolean {
  const next = shiftLocalDateKey(selectedDate, deltaDays);
  const start = toLocalDateKey(rangeStartDate(now, rangeDays));
  const end = toLocalDateKey(startOfDay(now));
  return next >= start && next <= end;
}
