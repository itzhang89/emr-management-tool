import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The SQL editor's own tab strip — one entry per open editor.
 *
 * Same shape as `ResultTabsPanel`, deliberately: the two strips sit one above
 * the other, and a result tab and an editor tab that looked different would
 * read as different kinds of thing when they are the same gesture.
 *
 * The `+` is part of the strip rather than the toolbar because that is where
 * the tabs are — a new editor is a new tab, and nothing else on the page is.
 */

export interface QueryTabStripItem {
  id: string;
  title: string;
  /** Revealed on hover — enough of the statement to tell two apart. */
  sql?: string;
}

export function QueryTabsPanel<T extends QueryTabStripItem>({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  canClose = true,
  newTabShortcut,
  children
}: {
  tabs: T[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  /** False when closing the last one would leave nowhere to type. */
  canClose?: boolean;
  /** Named in the `+` tooltip, so the button teaches the key that does it. */
  newTabShortcut?: string;
  /** The active tab's body. The strip owns the lookup, so callers needn't. */
  children: (activeTab: T) => React.ReactNode;
}) {
  const t = useT();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex min-h-5 shrink-0 items-center gap-px overflow-x-auto rounded-md border bg-muted/30 p-px">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={cn(
                "flex max-w-[150px] shrink-0 items-center gap-0 rounded-sm border px-0.5 transition-colors",
                isActive
                  ? "border-primary/60 bg-primary/10 shadow-sm ring-1 ring-primary/20"
                  : "border-transparent hover:bg-muted/60"
              )}
            >
              <button
                type="button"
                className={cn(
                  "min-w-0 overflow-hidden whitespace-nowrap px-1 text-left text-[10px] [text-overflow:clip]",
                  isActive ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"
                )}
                title={tab.sql?.trim() || tab.title}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.title}
              </button>
              {canClose && tabs.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-4 shrink-0"
                  aria-label={t("Close {title}", { title: tab.title })}
                  onClick={() => onCloseTab(tab.id)}
                >
                  <X className="size-2" />
                </Button>
              ) : null}
            </div>
          );
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-4 shrink-0"
              aria-label={t("New query tab")}
              onClick={onNewTab}
            >
              <Plus className="size-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("New query tab")}
            {newTabShortcut ? ` · ${newTabShortcut}` : ""}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab ? children(activeTab) : null}
      </div>
    </div>
  );
}
