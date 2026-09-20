import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";

export interface JobTabStripItem {
  id: string;
  title: string;
  /** Revealed on hover — the full name when the label dropped a timestamp. */
  tooltip?: string;
  /** The fixed Job History tab has no close button; log tabs do. */
  closable: boolean;
}

/**
 * The Job History workspace's tab strip: the fixed first tab, one tab per job
 * whose logs are open, and a `+` for a job the list does not show.
 *
 * It is a Radix `TabsList` so the strip keeps the tablist semantics and arrow
 * keys the DBHub strip has — but each tab is a wrapper holding the trigger
 * *beside* its close button rather than inside it. A button nested in a button
 * is invalid markup and swallows Enter/Space, which is exactly the trade
 * ResultTabsPanel avoids by not being a tablist at all.
 */
export function JobTabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab,
  focusRequestId
}: {
  tabs: JobTabStripItem[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: () => void;
  /** Bumped by the page when a shortcut changed the tab. */
  focusRequestId?: number;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);

  // Radix moves focus for its own arrow keys, but not for a value the page set
  // from a shortcut — so the ring would stay on the tab the user just left
  // while the pane behind it changed. Carry it across by hand.
  useEffect(() => {
    if (!focusRequestId) return;
    listRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
  }, [focusRequestId]);

  return (
    // One scrolling row: `+` sits directly after the last tab — where the next
    // one would appear — instead of being pinned to the far edge of the window.
    <div className="min-w-0 shrink-0 overflow-x-auto">
      <div className="flex w-fit items-center gap-1">
        <TabsList ref={listRef} className="h-9 justify-start gap-1 bg-muted/60 p-1">
          {tabs.map((tab) => (
            <div key={tab.id} className="flex shrink-0 items-center">
              <TabsTrigger
                value={tab.id}
                title={tab.tooltip ?? tab.title}
                className="max-w-[200px] truncate px-2.5 py-1 text-xs"
              >
                {tab.title}
              </TabsTrigger>
              {tab.closable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0"
                  aria-label={t("Close {title}", { title: tab.title })}
                  onClick={() => onClose(tab.id)}
                >
                  <X className="size-2.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </TabsList>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t("Open a log tab")}
          title={t("Open a log tab")}
          onClick={onNewTab}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
