import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import {
  isCloseTabKey,
  isNewTabKey,
  isTabCycleNextKey,
  isTabCyclePreviousKey
} from "@/lib/keyboardShortcut";
import { QueryTabsPanel, type QueryTabStripItem } from "./QueryTabsPanel";

/**
 * The right-hand half of a query workspace, shared by the two that have one:
 * the JDBC connections and the Glue catalog.
 *
 * It owns the shape and the keyboard, and nothing else — no tab is created or
 * destroyed here, and no SQL is run here. The tabs arrive already named, the
 * two halves arrive as render props, and what happens when a chord is pressed
 * arrives as callbacks. That is deliberate: the two workspaces keep their own
 * state in their own shape (one persists drafts to a per-connection cache, the
 * other holds Athena executions), and the only thing they have ever disagreed
 * about by accident is how this column looks and which key does what.
 *
 * The tabs are two strips, one inside the other: the outer holds the editors,
 * the inner holds the result tabs of whichever editor is on screen. That
 * nesting is the point — an editor's results belong to the editor, so closing
 * it closes them, and two drafts open side by side never overwrite each
 * other's grid.
 *
 * `result` may answer null for a tab, and then there is no second half at all:
 * the editor takes the column, with no strip and no splitter. Glue's metadata
 * pane is a tab of that kind — it is not an editor and has no results.
 */

export interface WorkspaceHalfActions {
  /** Step to the neighbouring tab of this half, wrapping at either end. */
  onCycle: (delta: 1 | -1) => void;
  /** Close this half's tab in front. Refusing is the callee's business. */
  onCloseActive: () => void;
}

export function QueryWorkspaceColumn<T extends QueryTabStripItem>({
  active = true,
  header,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  newTabShortcut,
  onCycleTabs,
  onCloseActiveTab,
  editor,
  result
}: {
  /** Only the workspace on screen answers a chord. */
  active?: boolean;
  /**
   * The row above the strip. It belongs *inside* this column rather than beside
   * it because the column is what claims the query half: a click on a Run
   * button up here has to count the way a click in the editor does.
   *
   * It is given the active tab so a workspace can drop the row on a tab that is
   * not an editor — Glue's SQL toolbar has no business being on screen while
   * the metadata pane is.
   */
  header?: (tab: T) => ReactNode;
  tabs: T[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  newTabShortcut?: string;
  onCycleTabs: (delta: 1 | -1) => void;
  onCloseActiveTab: () => void;
  /** The active tab's editor half. The column supplies the height it may take. */
  editor: (tab: T) => ReactNode;
  /**
   * The active tab's result half, or null for a tab that has none. The node is
   * the whole strip — this column does not know what a result tab is, but it
   * does need to know how to move through them, hence the two callbacks.
   */
  result?: (tab: T) => (WorkspaceHalfActions & { node: ReactNode }) | null;
}) {
  const t = useT();
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
  /**
   * Which of the two strips the shortcut keys act on: the editors or the
   * results. Set by whichever half the pointer or the keyboard was last in,
   * because on this page the same chord means two things and only the user
   * knows which one they meant.
   */
  const [activeHalf, setActiveHalf] = useState<"query" | "result">("query");

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const resultHalf = activeTab && result ? result(activeTab) : null;
  // A tab with no result strip has no result half to be in, whatever was
  // touched last, so the chords fall back to the editors.
  const half = resultHalf ? activeHalf : "query";

  /**
   * The chords are read through a ref so the window listener can be installed
   * once and still see the tabs as they are now. The alternative — memoising
   * every callback so the effect can depend on them — buys nothing here, since
   * a render that changes a tab is a render whose listener should change too.
   */
  const handleKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    handleKeyDownRef.current = (event: KeyboardEvent) => {
      const onResultHalf = half === "result" ? resultHalf : null;

      // Every one of these chords is also a browser or window key — ⌘W closes
      // the window — so each is prevented even when the workspace then declines
      // to act on it: the key belongs to the page that is on screen.
      if (isTabCyclePreviousKey(event)) {
        event.preventDefault();
        if (onResultHalf) onResultHalf.onCycle(-1);
        else onCycleTabs(-1);
        return;
      }
      if (isTabCycleNextKey(event)) {
        event.preventDefault();
        if (onResultHalf) onResultHalf.onCycle(1);
        else onCycleTabs(1);
        return;
      }
      if (isNewTabKey(event)) {
        event.preventDefault();
        onNewTab();
        return;
      }
      if (isCloseTabKey(event)) {
        event.preventDefault();
        if (onResultHalf) onResultHalf.onCloseActive();
        else onCloseActiveTab();
      }
    };
  });

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => handleKeyDownRef.current(event);
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  /**
   * The drag is the catalog's, turned on its side. The editor keeps its height
   * and the grid takes the rest, rather than the two sharing what is left
   * over: a split that only redistributes slack moves both edges when one is
   * dragged, which is not what a splitter looks like it does.
   */
  const beginEditorResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = editorHeight;

    const handleMove = (moveEvent: MouseEvent) => {
      setEditorHeight(clampEditorHeight(startHeight + moveEvent.clientY - startY));
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <QueryTabsPanel
      tabs={tabs}
      activeTabId={activeTabId}
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      onNewTab={onNewTab}
      newTabShortcut={newTabShortcut}
    >
      {(tab) => (
        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
          onMouseDownCapture={() => setActiveHalf("query")}
          onFocusCapture={() => setActiveHalf("query")}
        >
          {header ? header(tab) : null}

          {resultHalf ? (
            <>
              {/* The editor's height is the user's to set and the grid takes the
                  rest — see `beginEditorResize`. Capped in CSS as well as in the
                  drag, so a short window cannot let the editor push the grid out
                  of the column entirely. */}
              <div className="max-h-[75%] shrink-0" style={{ height: editorHeight }}>
                {editor(tab)}
              </div>

              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t("Resize the editor and result areas")}
                aria-valuemin={MIN_EDITOR_HEIGHT}
                aria-valuemax={MAX_EDITOR_HEIGHT}
                aria-valuenow={editorHeight}
                className="group relative h-2 shrink-0 cursor-row-resize touch-none"
                onMouseDown={beginEditorResize}
              >
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border group-hover:bg-primary/50" />
              </div>

              <div
                className="min-h-0 flex-1 overflow-hidden"
                onMouseDownCapture={() => setActiveHalf("result")}
                onFocusCapture={() => setActiveHalf("result")}
              >
                {resultHalf.node}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden">{editor(tab)}</div>
          )}
        </div>
      )}
    </QueryTabsPanel>
  );
}

/**
 * How short and how tall the editor may be dragged. The floor is the editor's
 * own: CodeMirror's theme refuses to render shorter than 140px, so a smaller
 * number would just be a height the pane silently exceeds.
 */
const DEFAULT_EDITOR_HEIGHT = 220;
const MIN_EDITOR_HEIGHT = 140;
const MAX_EDITOR_HEIGHT = 560;
const clampEditorHeight = (height: number) =>
  Math.min(MAX_EDITOR_HEIGHT, Math.max(MIN_EDITOR_HEIGHT, height));
