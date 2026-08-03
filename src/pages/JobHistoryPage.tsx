import { useEffect, useRef, useState } from "react";
import { RecentSearchInput, type RecentSearchInputHandle } from "@/components/search/RecentSearchInput";
import { JobAutoRefreshToggle } from "@/components/emr/JobAutoRefreshToggle";
import { JobRunsPanel } from "@/components/emr/JobRunsPanel";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { useJobRuns } from "@/hooks/useEmr";
import { useJobHistoryAutoRefresh } from "@/hooks/useJobHistoryAutoRefresh";
import { isFocusSearchKey } from "@/lib/keyboardShortcut";
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
  const [recentSearches, setRecentSearches] = useState(() => readJobHistorySearchHistory());
  const searchInputRef = useRef<RecentSearchInputHandle>(null);
  const submittedKeyword = submittedSearch.trim() || undefined;
  const { autoRefresh, setAutoRefresh, refreshCountdown, setRefreshCountdown } = useJobHistoryAutoRefresh();
  const jobs = useJobRuns(effectiveVirtualClusterId, autoRefresh, submittedKeyword);

  useEffect(() => {
    if (!autoRefresh) return;
    setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
  }, [autoRefresh, jobs.dataUpdatedAt, setRefreshCountdown]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isFocusSearchKey(event)) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const submitLocalSearch = (rawQuery: string) => {
    const original = rawQuery.trim();
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
      return;
    }
    setSubmittedSearch(normalized);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pageId="history"
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <RecentSearchInput
              ref={searchInputRef}
              value={searchInput}
              onChange={setSearchInput}
              onSubmit={submitLocalSearch}
              recentSearches={recentSearches}
              placeholder="Search jobs by name, id, or state"
              listLabel="Recent job searches"
            />
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
