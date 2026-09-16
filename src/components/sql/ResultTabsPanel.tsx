import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The result tab strip every workspace shares.
 *
 * It knows five scalar facts about a tab and nothing else. Athena's tabs carry
 * a query execution and a paged result set; a JDBC connection's carry a
 * materialised result and the moment it ran. Neither type is renamed or merged
 * — the strip takes the handful of fields it actually renders, and each side
 * hands its own body to `children`.
 */

export interface ResultTabStripItem {
  id: string;
  title: string;
  /** Revealed on hover — the full statement behind a shortened title. */
  tooltip?: string;
  /** Drives the amber "still going" marker on an inactive tab. */
  running?: boolean;
}

export function ResultTabsPanel<T extends ResultTabStripItem>({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  children,
  emptyLabel = "No result tabs."
}: {
  tabs: T[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** The active tab's body. The strip owns the lookup, so callers needn't. */
  children: (activeTab: T) => React.ReactNode;
  emptyLabel?: string;
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex min-h-6 shrink-0 items-center gap-0.5 overflow-x-auto rounded-md border bg-muted/30 p-0.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const running = Boolean(tab.running);
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
                title={tab.tooltip || tab.title}
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
          children(activeTab)
        ) : (
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}
