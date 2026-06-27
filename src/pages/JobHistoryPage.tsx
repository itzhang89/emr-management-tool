import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { JobAutoRefreshToggle } from "@/components/emr/JobAutoRefreshToggle";
import { JobRunsPanel } from "@/components/emr/JobRunsPanel";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { useJobRuns } from "@/hooks/useEmr";
import { useJobHistoryAutoRefresh } from "@/hooks/useJobHistoryAutoRefresh";
import { isLikelyEmrJobRunId } from "@/services/emrJobId";
import { JOB_HISTORY_REFRESH_INTERVAL_SECONDS } from "@/services/jobHistoryConstants";

export function JobHistoryPage({ onOpenLogs }: { onOpenLogs?: () => void; onOpenS3?: () => void }) {
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [findInAwsSignal, setFindInAwsSignal] = useState(0);
  const submittedKeyword = submittedSearch.trim() || undefined;
  const { autoRefresh, setAutoRefresh, refreshCountdown, setRefreshCountdown } = useJobHistoryAutoRefresh();
  const jobs = useJobRuns(effectiveVirtualClusterId, autoRefresh, submittedKeyword);

  useEffect(() => {
    if (!autoRefresh) return;
    setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
  }, [autoRefresh, jobs.dataUpdatedAt, setRefreshCountdown]);

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
            <JobAutoRefreshToggle
              id="job-history-auto-refresh"
              autoRefresh={autoRefresh}
              onAutoRefreshChange={setAutoRefresh}
              isFetching={jobs.isFetching}
              refreshCountdown={refreshCountdown}
            />
            <VirtualClusterSelect />
            <span className="shrink-0 text-sm text-muted-foreground">{(jobs.data ?? []).length} jobs</span>
          </div>
        }
      />

      <JobRunsPanel
        virtualClusterId={effectiveVirtualClusterId}
        keyword={submittedKeyword}
        autoRefresh={autoRefresh}
        onOpenLogs={onOpenLogs}
        showFindInAws
        searchedJobId={submittedSearch.trim()}
        findInAwsSignal={findInAwsSignal}
        clusterJobsQuery={jobs}
      />
    </div>
  );
}
