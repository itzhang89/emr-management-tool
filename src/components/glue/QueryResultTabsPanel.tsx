import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QueryResultsPanel } from "@/components/glue/QueryResultsPanel";
import type { QueryResultTab } from "@/services/queryResultTabs";

export function QueryResultTabsPanel({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onLoadMore,
  onExport,
  exporting
}: {
  tabs: QueryResultTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onLoadMore: (tabId: string) => void;
  onExport: (tabId: string) => void;
  exporting: boolean;
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex min-h-8 shrink-0 items-center gap-1 overflow-x-auto rounded-md border bg-muted/30 p-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const running = tab.execution?.state === "QUEUED" || tab.execution?.state === "RUNNING";
          return (
            <div
              key={tab.id}
              className={cn(
                "flex max-w-[220px] shrink-0 items-center gap-0.5 rounded-sm border px-1",
                isActive ? "border-border bg-background shadow-sm" : "border-transparent"
              )}
            >
              <button
                type="button"
                className={cn(
                  "min-w-0 truncate px-2 py-1 text-left text-xs",
                  isActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                title={tab.sqlSnapshot || tab.title}
                onClick={() => onSelectTab(tab.id)}
              >
                {running ? "● " : ""}
                {tab.title}
              </button>
              {tabs.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => onCloseTab(tab.id)}
                >
                  <X className="size-3" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border p-3">
        {activeTab ? (
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
        ) : (
          <p className="text-xs text-muted-foreground">No result tabs.</p>
        )}
      </div>
    </div>
  );
}
