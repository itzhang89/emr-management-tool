import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { JobAutoRefreshToggle } from "@/components/emr/JobAutoRefreshToggle";
import { JobRunsPanel } from "@/components/emr/JobRunsPanel";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { useJobRuns } from "@/hooks/useEmr";
import { useJobHistoryAutoRefresh } from "@/hooks/useJobHistoryAutoRefresh";
import { isLikelyEmrJobRunId, normalizeEmrJobRunId } from "@/services/emrJobId";
import { JOB_HISTORY_REFRESH_INTERVAL_SECONDS } from "@/services/jobHistoryConstants";
import {
  readJobHistorySearchHistory,
  rememberJobHistorySearch
} from "@/services/jobHistorySearchHistory";

export function JobHistoryPage({ onOpenLogs }: { onOpenLogs?: () => void; onOpenS3?: () => void }) {
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [findInAwsSignal, setFindInAwsSignal] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => readJobHistorySearchHistory());
  const submittedKeyword = submittedSearch.trim() || undefined;
  const { autoRefresh, setAutoRefresh, refreshCountdown, setRefreshCountdown } = useJobHistoryAutoRefresh();
  const jobs = useJobRuns(effectiveVirtualClusterId, autoRefresh, submittedKeyword);

  useEffect(() => {
    if (!autoRefresh) return;
    setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
  }, [autoRefresh, jobs.dataUpdatedAt, setRefreshCountdown]);

  const submitLocalSearch = (rawQuery?: string) => {
    const original = (rawQuery ?? searchInput).trim();
    if (rawQuery !== undefined) {
      setSearchInput(rawQuery);
    }
    if (original) {
      setRecentSearches(rememberJobHistorySearch(original));
    }
    const normalized = normalizeEmrJobRunId(original);
    if (
      normalized === submittedSearch.trim() &&
      normalized &&
      isLikelyEmrJobRunId(normalized) &&
      (jobs.data ?? []).length === 0
    ) {
      setFindInAwsSignal((value) => value + 1);
      setHistoryOpen(false);
      return;
    }
    setSubmittedSearch(normalized);
    setHistoryOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pageId="history"
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Popover open={historyOpen && recentSearches.length > 0} onOpenChange={setHistoryOpen}>
              <PopoverAnchor asChild>
                <div className="relative w-[16rem] min-w-[16rem]">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 pl-9"
                    placeholder="Search jobs by name, id, state, or keyword"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onFocus={() => setHistoryOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitLocalSearch();
                      }
                      if (event.key === "Escape") {
                        setHistoryOpen(false);
                      }
                    }}
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                align="start"
                className="w-[16rem] p-1"
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <ul className="max-h-60 overflow-auto">
                  {recentSearches.map((query) => (
                    <li key={query}>
                      <button
                        type="button"
                        className="flex w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => submitLocalSearch(query)}
                      >
                        {query}
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
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
