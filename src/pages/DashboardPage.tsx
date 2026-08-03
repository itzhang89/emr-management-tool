import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { JobRunsDailyChart } from "@/components/emr/JobRunsDailyChart";
import { JobRunsHourlyChart } from "@/components/emr/JobRunsHourlyChart";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useJobRuns } from "@/hooks/useEmr";
import { formatAppError } from "@/services/appErrorMessage";
import {
  STATS_RANGE_OPTIONS,
  aggregateDailyJobCounts,
  aggregateHourlyJobCounts,
  canShiftSelectedDate,
  clampSelectedDate,
  countFailedInLast24Hours,
  countRunningJobs,
  shiftLocalDateKey,
  successRatePercent,
  toLocalDateKey,
  type StatsRangeDays
} from "@/services/jobRunStats";

export function DashboardPage() {
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const [rangeDays, setRangeDays] = useState<StatsRangeDays>(7);
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateKey(new Date()));
  const [now] = useState(() => new Date());
  const jobsQuery = useJobRuns(effectiveVirtualClusterId, false, undefined, Boolean(effectiveVirtualClusterId), rangeDays);
  const jobList = jobsQuery.data ?? [];

  useEffect(() => {
    setSelectedDate(toLocalDateKey(new Date()));
  }, [effectiveVirtualClusterId]);

  useEffect(() => {
    setSelectedDate((current) => clampSelectedDate(current, new Date(), rangeDays));
  }, [rangeDays]);

  useEffect(() => {
    if (!jobsQuery.error) return;
    toast.error(formatAppError(jobsQuery.error, "Failed to sync job runs for dashboard stats."));
  }, [jobsQuery.error]);

  const liveNow = useMemo(
    () => (jobsQuery.dataUpdatedAt ? new Date(jobsQuery.dataUpdatedAt) : now),
    [jobsQuery.dataUpdatedAt, now]
  );
  const daily = useMemo(
    () => aggregateDailyJobCounts(jobList, liveNow, rangeDays),
    [jobList, liveNow, rangeDays]
  );
  const hourly = useMemo(
    () => aggregateHourlyJobCounts(jobList, selectedDate),
    [jobList, selectedDate]
  );
  const runningJobs = countRunningJobs(jobList);
  const successRate = successRatePercent(jobList, liveNow, rangeDays);
  const failed24h = countFailedInLast24Hours(jobList, liveNow);
  const canGoPrev = canShiftSelectedDate(selectedDate, -1, liveNow, rangeDays);
  const canGoNext = canShiftSelectedDate(selectedDate, 1, liveNow, rangeDays);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        pageId="dashboard"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <VirtualClusterSelect />
            <div className="flex items-center gap-1 rounded-md border p-1">
              {STATS_RANGE_OPTIONS.map((days) => (
                <Button
                  key={days}
                  type="button"
                  size="sm"
                  variant={rangeDays === days ? "default" : "ghost"}
                  onClick={() => setRangeDays(days)}
                >
                  {days}d
                </Button>
              ))}
            </div>
          </div>
        }
      />

      {!effectiveVirtualClusterId ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Select a virtual cluster to view job statistics.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              ["Running", String(runningJobs), "Currently running jobs"],
              [
                `Success Rate (${rangeDays}d)`,
                successRate == null ? "—" : `${successRate}%`,
                "Completed / (completed + failed)"
              ],
              ["Failed (24h)", String(failed24h), "Rolling last 24 hours"]
            ].map(([title, value, description]) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold">{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <JobRunsDailyChart
            data={daily}
            rangeDays={rangeDays}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            syncing={jobsQuery.isFetching}
          />
          <JobRunsHourlyChart
            data={hourly}
            selectedDate={selectedDate}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            onPrev={() => setSelectedDate((current) => shiftLocalDateKey(current, -1))}
            onNext={() => setSelectedDate((current) => shiftLocalDateKey(current, 1))}
            onToday={() => setSelectedDate(toLocalDateKey(new Date()))}
          />
        </>
      )}
    </div>
  );
}
