import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
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
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const submittedKeyword = submittedSearch.trim() || undefined;
  const { autoRefresh, setAutoRefresh, refreshCountdown, setRefreshCountdown } = useJobHistoryAutoRefresh();
  const jobs = useJobRuns(effectiveVirtualClusterId, autoRefresh, submittedKeyword);
  const showRecentSearches = historyOpen && recentSearches.length > 0;

  useEffect(() => {
    if (!autoRefresh) return;
    setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
  }, [autoRefresh, jobs.dataUpdatedAt, setRefreshCountdown]);

  useEffect(() => {
    if (!historyOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && searchContainerRef.current?.contains(target)) return;
      setHistoryOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [historyOpen]);

  const openRecentSearches = () => {
    if (recentSearches.length === 0) return;
    setHistoryOpen(true);
  };

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
            <div ref={searchContainerRef} className="relative w-[16rem] min-w-[16rem]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="Search jobs by name, id, state, or keyword"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onFocus={openRecentSearches}
                onClick={openRecentSearches}
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
              {showRecentSearches ? (
                <ul
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                  role="listbox"
                  aria-label="Recent searches"
                >
                  {recentSearches.map((query) => (
                    <li key={query} role="option">
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
              ) : null}
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
