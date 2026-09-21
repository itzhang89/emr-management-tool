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
 * It lives beside `ResultTabsPanel` rather than inside either workspace because
 * both of them keep editors this way: the JDBC connections and the Glue
 * catalog. Which is also why nothing here knows what an editor *is* — the tabs
 * arrive as a title and a tooltip, and the body arrives as `children`.
 *
 * The `+` is part of the strip rather than the toolbar because that is where
 * the tabs are — a new editor is a new tab, and nothing else on the page is.
 */

export interface QueryTabStripItem {
  id: string;
  title: string;
  /** Revealed on hover — enough of the statement to tell two apart. */
  sql?: string;
  /**
   * False pins the tab open. The strip already hides the X when it holds a
   * single tab, but a workspace can also mix in tabs of another kind — Glue's
   * metadata pane sits in the same strip — and then "the last editor" is not
   * "the last tab", which only the workspace knows.
   */
  closable?: boolean;
}

/**
 * What the next editor tab is called. Numbered from the highest one in use
 * rather than from the count, so closing "Query 2" does not hand its name to
 * the next tab while a "Query 3" is still open beside it.
 *
 * It is here rather than in a workspace because the name is the strip's to
 * give: both workspaces open editors into the same strip, and two of them
 * numbering tabs differently would show.
 */
export function nextQueryTitle(tabs: ReadonlyArray<{ title: string }>): string {
  const used = tabs
    .map((tab) => /^Query (\d+)$/.exec(tab.title)?.[1])
    .filter((index): index is string => index !== undefined)
    .map(Number);
  return `Query ${(used.length ? Math.max(...used) : 0) + 1}`;
}

export function QueryTabsPanel<T extends QueryTabStripItem>({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  newTabShortcut,
  children
}: {
  tabs: T[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
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
              {tab.closable !== false && tabs.length > 1 ? (
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
