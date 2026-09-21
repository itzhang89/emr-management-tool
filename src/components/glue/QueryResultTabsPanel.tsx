import { QueryResultsPanel } from "@/components/glue/QueryResultsPanel";
import { ResultTabsPanel, type ResultTabStripItem } from "@/components/sql/ResultTabsPanel";
import type { QueryResultTab } from "@/services/queryResultTabs";

/**
 * The Athena flavour of the shared result tabs: it teaches the strip which of
 * Athena's tab facts mean "still running" and hands the body over to
 * `QueryResultsPanel`. The strip itself knows none of that.
 */
export function QueryResultTabsPanel({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onLoadMore,
  onExport,
  exporting,
  emptyLabel
}: {
  tabs: QueryResultTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onLoadMore: (tabId: string) => void;
  onExport: (tabId: string) => void;
  exporting: boolean;
  /** Shown when the editor has no result tab yet — a freshly opened one has none. */
  emptyLabel?: string;
}) {
  const stripTabs: Array<QueryResultTab & ResultTabStripItem> = tabs.map((tab) => ({
    ...tab,
    tooltip: tab.sqlSnapshot,
    running: tab.execution?.state === "QUEUED" || tab.execution?.state === "RUNNING"
  }));

  return (
    <ResultTabsPanel
      tabs={stripTabs}
      activeTabId={activeTabId}
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      emptyLabel={emptyLabel}
    >
      {(activeTab) => (
        <QueryResultsPanel
          execution={activeTab.execution}
          results={activeTab.results}
          loading={activeTab.resultsLoading ?? false}
          error={activeTab.resultsError}
          hasMore={Boolean(activeTab.results?.nextToken)}
          onLoadMore={() => onLoadMore(activeTab.id)}
          onExport={() => onExport(activeTab.id)}
          exporting={exporting}
        />
      )}
    </ResultTabsPanel>
  );
}
