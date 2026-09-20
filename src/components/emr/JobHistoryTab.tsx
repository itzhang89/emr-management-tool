import { useEffect, useRef, useState } from "react";
import { JobAutoRefreshToggle } from "@/components/emr/JobAutoRefreshToggle";
import { JobRunsPanel } from "@/components/emr/JobRunsPanel";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { RecentSearchInput, type RecentSearchInputHandle } from "@/components/search/RecentSearchInput";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useJobRuns } from "@/hooks/useEmr";
import { useJobHistoryAutoRefresh } from "@/hooks/useJobHistoryAutoRefresh";
import { useT } from "@/i18n";
import { isFocusSearchKey } from "@/lib/keyboardShortcut";
import { isLikelyEmrJobRunId, normalizeEmrJobRunId } from "@/services/emrJobId";
import { JOB_HISTORY_REFRESH_INTERVAL_SECONDS } from "@/services/jobHistoryConstants";
import {
  readJobHistorySearchHistory,
  rememberJobHistorySearch
} from "@/services/jobHistorySearchHistory";
import type { JobRunSummary } from "@/types/domain";

/**
 * The Job History tab: the job list as it was before logs moved in beside it.
 *
 * The only thing the tab treatment changed is Mod+F. The search box and every
 * open log tab's find bar listen on `window`, so an ungated handler here would
 * steal the shortcut from a log tab — ⌘F would jump to a search field the user
 * cannot even see.
 */
export function JobHistoryTab({
  active,
  onOpenLogs,
  onOpenSubmit,
  onOpenAiAssistant
}: {
  active: boolean;
  /** Opens (or focuses) a tab for the job whose Logs button was pressed. */
  onOpenLogs?: (job: JobRunSummary) => void;
  onOpenSubmit?: () => void;
  onOpenAiAssistant?: () => void;
}) {
  const t = useT();
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [findInAwsSignal, setFindInAwsSignal] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchInputRef = useRef<RecentSearchInputHandle>(null);
  const submittedKeyword = submittedSearch.trim() || undefined;
  const { autoRefresh, setAutoRefresh, refreshCountdown, setRefreshCountdown } = useJobHistoryAutoRefresh();
  const jobs = useJobRuns(effectiveVirtualClusterId, autoRefresh, submittedKeyword);

  useEffect(() => {
    setRecentSearches(accountId ? readJobHistorySearchHistory(accountId) : []);
  }, [accountId]);

  useEffect(() => {
    if (!autoRefresh) return;
    setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
  }, [autoRefresh, jobs.dataUpdatedAt, setRefreshCountdown]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isFocusSearchKey(event)) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  const submitLocalSearch = (rawQuery: string) => {
    const original = rawQuery.trim();
    if (original && accountId) {
      setRecentSearches(rememberJobHistorySearch(accountId, original));
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
      {/* No PageHeader here: the workspace's first tab is already labelled
          "Job History", and the sidebar entry right above it carries the
          description a page header would repeat verbatim. What is left is a
          toolbar, so it is written as one. `justify-end` keeps the controls
          where the header's `justify-between` had them — against the right
          edge, over the table they act on. */}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <RecentSearchInput
          ref={searchInputRef}
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={submitLocalSearch}
          recentSearches={recentSearches}
          placeholder={t("Search jobs by name, id, or state")}
          listLabel={t("Recent job searches")}
        />
        <JobAutoRefreshToggle
          id="job-history-auto-refresh"
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
          isFetching={jobs.isFetching}
          refreshCountdown={refreshCountdown}
        />
        <VirtualClusterSelect />
        <span className="shrink-0 text-sm text-muted-foreground">
          {t("{count} jobs", { count: (jobs.data ?? []).length })}
        </span>
      </div>

      <JobRunsPanel
        virtualClusterId={effectiveVirtualClusterId}
        keyword={submittedKeyword}
        autoRefresh={autoRefresh}
        onOpenLogs={onOpenLogs}
        onOpenSubmit={onOpenSubmit}
        onOpenAiAssistant={onOpenAiAssistant}
        showFindInAws
        searchedJobId={submittedSearch.trim()}
        findInAwsSignal={findInAwsSignal}
        clusterJobsQuery={jobs}
      />
    </div>
  );
}
