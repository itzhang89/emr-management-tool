import { type ReactNode, useEffect, useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_LOG_VIEW_CHARACTERS } from "@/services/logDisplay";
import { selectRenderableMatches, type SearchMatch } from "@/services/logSearch";

type LogDisplayState = {
  text: string;
  truncated: boolean;
  totalCharacters: number;
  showingFullContent: boolean;
};

export function LogContentPanel({
  logDisplay,
  hasSelection,
  onLoadFullLog,
  onDownload,
  submittedSearch,
  deferredLogText,
  matches,
  activeMatchIndex
}: {
  logDisplay: LogDisplayState;
  hasSelection: boolean;
  onLoadFullLog: () => void;
  onDownload: () => void;
  submittedSearch: string;
  deferredLogText: string;
  matches: SearchMatch[];
  activeMatchIndex: number;
}) {
  const highlightedLogContent = useMemo(() => {
    if (!hasSelection || !logDisplay.text) {
      return "Select a log file from the tree to view its content.";
    }
    if (!submittedSearch) return deferredLogText;
    return renderHighlightedLogText(deferredLogText, matches, activeMatchIndex);
  }, [activeMatchIndex, deferredLogText, hasSelection, logDisplay.text, matches, submittedSearch]);

  const showTruncationBanner = logDisplay.truncated && !logDisplay.showingFullContent;

  useEffect(() => {
    const activeMatch = document.querySelector('[data-active-log-search-match="true"]') as HTMLElement | null;
    activeMatch?.scrollIntoView?.({ block: "center" });
  }, [activeMatchIndex, matches]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {showTruncationBanner ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>
            Previewing the first {MAX_LOG_VIEW_CHARACTERS.toLocaleString("en-US")} characters of this log (
            {logDisplay.totalCharacters.toLocaleString("en-US")} total). Load the full log to search and browse everything
            in the viewer, or download it to a file.
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onLoadFullLog}>
              Load full log
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void onDownload()}>
              <Download data-icon="inline-start" />
              Download
            </Button>
          </div>
        </div>
      ) : null}
      {logDisplay.showingFullContent && logDisplay.truncated ? (
        <div className="shrink-0 border-b border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          Showing the full log ({logDisplay.totalCharacters.toLocaleString("en-US")} characters) in the viewer.
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4">
        <pre data-testid="log-content" className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-100">
          {highlightedLogContent}
        </pre>
      </div>
    </div>
  );
}

function renderHighlightedLogText(text: string, matches: SearchMatch[], activeMatchIndex: number) {
  if (matches.length === 0) return text;

  const { matches: visibleMatches, activeIndex } = selectRenderableMatches(matches, activeMatchIndex);
  const parts: ReactNode[] = [];
  let cursor = visibleMatches[0]?.start ?? 0;

  if (cursor > 0) {
    parts.push(text.slice(0, cursor));
  }

  visibleMatches.forEach((match, index) => {
    if (match.start > cursor) {
      parts.push(text.slice(cursor, match.start));
    }
    const isActive = index === activeIndex;
    parts.push(
      <mark
        key={`${match.start}-${match.end}-${index}`}
        data-testid="log-search-match"
        data-active-log-search-match={isActive ? "true" : undefined}
        className={cn(isActive ? "bg-yellow-300 text-slate-950" : "bg-yellow-500/50 text-slate-50")}
      >
        {text.slice(match.start, match.end)}
      </mark>
    );
    cursor = match.end;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}
