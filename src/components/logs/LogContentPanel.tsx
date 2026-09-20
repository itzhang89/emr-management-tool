import { type ReactNode, useEffect, useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogFindBar } from "@/components/logs/LogFindBar";
import { useT } from "@/i18n";
import { MAX_LOG_VIEW_CHARACTERS } from "@/services/logDisplay";
import { type SearchMatch } from "@/services/logSearch";
import { renderSemanticLogContent } from "@/components/logs/renderSemanticLogContent";

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
  activeMatchIndex,
  hiddenNoiseCount = 0,
  semanticHighlight = true,
  findOpen,
  searchInput,
  onSearchInputChange,
  regexSearch,
  onRegexSearchChange,
  onSubmitSearch,
  onCloseFind,
  resultLabel,
  searchError,
  onPreviousMatch,
  onNextMatch,
  searchDisabled,
  findFocusRequestId
}: {
  logDisplay: LogDisplayState;
  hasSelection: boolean;
  onLoadFullLog: () => void;
  onDownload: () => void;
  submittedSearch: string;
  deferredLogText: string;
  matches: SearchMatch[];
  activeMatchIndex: number;
  hiddenNoiseCount?: number;
  /** When false (Focus unchecked), skip LEVEL/ETL/step coloring; search marks only. */
  semanticHighlight?: boolean;
  findOpen: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  regexSearch: boolean;
  onRegexSearchChange: (checked: boolean) => void;
  onSubmitSearch: () => void;
  onCloseFind: () => void;
  resultLabel: string;
  searchError?: string;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  searchDisabled?: boolean;
  findFocusRequestId?: number;
}) {
  const t = useT();

  const highlightedLogContent = useMemo((): ReactNode => {
    if (!hasSelection || !logDisplay.text) {
      return t("Select a log file from the tree to view its content.");
    }
    const text = submittedSearch ? deferredLogText : logDisplay.text;
    return renderSemanticLogContent(text, submittedSearch ? matches : [], activeMatchIndex, {
      semanticHighlight
    });
  }, [
    activeMatchIndex,
    deferredLogText,
    hasSelection,
    logDisplay.text,
    matches,
    semanticHighlight,
    submittedSearch,
    t
  ]);

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
            {t(
              "Previewing the first {previewCount} characters of this log ({totalCount} total). Load the full log to search and browse everything in the viewer, or download it to a file.",
              {
                previewCount: MAX_LOG_VIEW_CHARACTERS.toLocaleString("en-US"),
                totalCount: logDisplay.totalCharacters.toLocaleString("en-US")
              }
            )}
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onLoadFullLog}>
              {t("Load full log")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void onDownload()}>
              <Download data-icon="inline-start" />
              {t("Download")}
            </Button>
          </div>
        </div>
      ) : null}
      {logDisplay.showingFullContent && logDisplay.truncated ? (
        <div className="shrink-0 border-b border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          {t("Showing the full log ({count} characters) in the viewer.", {
            count: logDisplay.totalCharacters.toLocaleString("en-US")
          })}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-950">
        <LogFindBar
          open={findOpen}
          searchInput={searchInput}
          onSearchInputChange={onSearchInputChange}
          regexSearch={regexSearch}
          onRegexSearchChange={onRegexSearchChange}
          onSubmitSearch={onSubmitSearch}
          onClose={onCloseFind}
          resultLabel={resultLabel}
          searchError={searchError}
          matchesCount={matches.length}
          onPreviousMatch={onPreviousMatch}
          onNextMatch={onNextMatch}
          disabled={searchDisabled}
          focusRequestId={findFocusRequestId}
        />
        {hiddenNoiseCount > 0 ? (
          <span
            data-testid="hidden-noise-count"
            className="pointer-events-none absolute right-3 top-2 z-10 text-[10px] leading-none text-slate-500"
          >
            {t("Hidden {count} lines", { count: hiddenNoiseCount.toLocaleString("en-US") })}
          </span>
        ) : null}
        <div className="h-full overflow-y-auto p-4">
          <pre
            data-testid="log-content"
            className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-200"
          >
            {highlightedLogContent}
          </pre>
        </div>
      </div>
    </div>
  );
}
