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
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex min-h-6 shrink-0 items-center gap-0.5 overflow-x-auto rounded-md border bg-muted/30 p-0.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const running = tab.execution?.state === "QUEUED" || tab.execution?.state === "RUNNING";
          return (
            <div
              key={tab.id}
              className={cn(
                "flex max-w-[180px] shrink-0 items-center gap-0 rounded-sm border px-0.5 transition-colors",
                isActive
                  ? "border-primary/60 bg-primary/10 shadow-sm ring-1 ring-primary/20"
                  : "border-transparent hover:bg-muted/60"
              )}
            >
              <button
                type="button"
                className={cn(
                  "min-w-0 overflow-hidden whitespace-nowrap px-1.5 py-0.5 text-left text-[10px] [text-overflow:clip]",
                  isActive
                    ? "font-semibold text-primary"
                    : "text-muted-foreground hover:text-foreground",
                  running && !isActive && "text-amber-600 dark:text-amber-400"
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
                  className="size-5 shrink-0"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => onCloseTab(tab.id)}
                >
                  <X className="size-2.5" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border p-2">
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
