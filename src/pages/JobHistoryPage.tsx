import { RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { JobRunsPanel, readAutoRefreshPreference, writeAutoRefreshPreference } from "@/components/emr/JobRunsPanel";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { useJobRuns } from "@/hooks/useEmr";
import { cn } from "@/lib/utils";

const jobHistoryRefreshIntervalSeconds = 5;

export function JobHistoryPage({ onOpenLogs }: { onOpenLogs?: () => void; onOpenS3?: () => void }) {
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const [autoRefresh, setAutoRefresh] = useState(() => readAutoRefreshPreference());
  const [refreshCountdown, setRefreshCountdown] = useState(jobHistoryRefreshIntervalSeconds);
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [findInAwsSignal, setFindInAwsSignal] = useState(0);
  const submittedKeyword = submittedSearch.trim() || undefined;
  const jobs = useJobRuns(effectiveVirtualClusterId, autoRefresh, submittedKeyword);

  const submitLocalSearch = () => {
    const trimmedSearch = searchInput.trim();
    if (
      trimmedSearch === submittedSearch.trim() &&
      trimmedSearch &&
      isLikelyEmrJobRunId(trimmedSearch) &&
      (jobs.data ?? []).length === 0
    ) {
      setFindInAwsSignal((value) => value + 1);
      return;
    }
    setSubmittedSearch(trimmedSearch);
  };

  useEffect(() => {
    writeAutoRefreshPreference(autoRefresh);
  }, [autoRefresh]);

  useEffect(() => {
    if (!autoRefresh) {
      setRefreshCountdown(jobHistoryRefreshIntervalSeconds);
      return;
    }

    setRefreshCountdown(jobHistoryRefreshIntervalSeconds);
    const timer = window.setInterval(() => {
      setRefreshCountdown((current) => (current <= 1 ? jobHistoryRefreshIntervalSeconds : current - 1));
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    if (autoRefresh) {
      setRefreshCountdown(jobHistoryRefreshIntervalSeconds);
    }
  }, [autoRefresh, jobs.dataUpdatedAt]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pageId="history"
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="relative w-[16rem] min-w-[16rem]">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="Search jobs by name, id, state, or keyword"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitLocalSearch();
                  }
                }}
              />
            </div>
            <div className="flex h-9 shrink-0 items-center gap-2 rounded-md border px-2">
              <Switch
                id="job-history-auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label="Auto refresh job history"
              />
              <label
                htmlFor="job-history-auto-refresh"
                className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"
              >
                <RefreshCw className={cn("size-3.5", autoRefresh && jobs.isFetching ? "animate-spin" : undefined)} />
                Auto refresh
                {autoRefresh ? <span className="tabular-nums">{refreshCountdown}s</span> : null}
              </label>
            </div>
            <VirtualClusterSelect />
            <span className="shrink-0 text-sm text-muted-foreground">{(jobs.data ?? []).length} jobs</span>
          </div>
        }
      />

      <JobRunsPanel
        virtualClusterId={effectiveVirtualClusterId}
        keyword={submittedKeyword}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onOpenLogs={onOpenLogs}
        showFindInAws
        searchedJobId={submittedSearch.trim()}
        findInAwsSignal={findInAwsSignal}
      />
    </div>
  );
}

function isLikelyEmrJobRunId(value: string) {
  const trimmed = value.trim();
  return /^job-[A-Za-z0-9-]+$/.test(trimmed) || /^[a-z0-9]{16,64}$/.test(trimmed);
}
