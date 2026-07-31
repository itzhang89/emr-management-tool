import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { LogCommandBar } from "@/components/logs/LogCommandBar";
import { LogContentPanel } from "@/components/logs/LogContentPanel";
import { LogFileTree } from "@/components/logs/LogFileTree";
import {
  buildPodLabelIndex,
  formatDestinationItems,
  formatLogBreadcrumb,
  getLogFullPath
} from "@/services/logPathDisplay";
import { MAX_LOG_VIEW_CHARACTERS, truncateLogTextForDisplay } from "@/services/logDisplay";
import { filterLogNoise } from "@/services/logNoiseFilter";
import { buildSearchResult, formatSearchMatchLabel } from "@/services/logSearch";
import { getShortcutPrimaryKey, SHORTCUT_IDS } from "@/data/keyboardShortcuts";
import type { CloudWatchLogDestination, S3LogDestination } from "@/services/jobLogDestinations";
import type { JobLogObject, JobLogStream, JobLogTreeSection } from "@/types/domain";

const LOG_FILES_TOGGLE_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.LOGS_TREE_TOGGLE);

export function LogWorkspace({
  activeSource,
  onSourceChange,
  sourceAvailability,
  destination,
  tree,
  selectedId,
  selectedItem,
  logText,
  isLoading,
  loadingMessage,
  errorMessage,
  onSelect,
  onDownload
}: {
  activeSource: "s3" | "cloudwatch";
  onSourceChange: (source: "s3" | "cloudwatch") => void;
  sourceAvailability: { s3: boolean; cloudwatch: boolean };
  destination: S3LogDestination | CloudWatchLogDestination;
  tree: JobLogTreeSection[];
  selectedId?: string;
  selectedItem?: JobLogStream | JobLogObject;
  logText: string;
  isLoading?: boolean;
  loadingMessage?: string;
  errorMessage?: string;
  onSelect: (item: JobLogStream | JobLogObject) => void;
  onDownload: () => void;
}) {
  const [findOpen, setFindOpen] = useState(false);
  const [findFocusRequestId, setFindFocusRequestId] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [regexSearch, setRegexSearch] = useState(true);
  const [submittedRegexSearch, setSubmittedRegexSearch] = useState(true);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [displayFullLog, setDisplayFullLog] = useState(false);
  const [focusNoiseFilter, setFocusNoiseFilter] = useState(true);
  const [logFilesCollapsed, setLogFilesCollapsed] = useState(true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) {
        if (event.key === "Escape" && findOpen) {
          event.preventDefault();
          setFindOpen(false);
          setSearchInput("");
          setSubmittedSearch("");
          setSubmittedRegexSearch(true);
          setRegexSearch(true);
          setActiveMatchIndex(0);
        }
        return;
      }

      if (event.key === "\\") {
        event.preventDefault();
        setLogFilesCollapsed((collapsed) => !collapsed);
        return;
      }

      if (event.key === "f" || event.key === "F") {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const inEditable =
          tag === "input" || tag === "textarea" || target?.isContentEditable;
        // Allow Cmd+F from the find input itself (toggle close); block only other fields.
        const inFindInput = target?.closest?.('[data-testid="log-find-bar"]');
        if (inEditable && !inFindInput) return;

        event.preventDefault();
        if (findOpen) {
          setFindOpen(false);
          setSearchInput("");
          setSubmittedSearch("");
          setSubmittedRegexSearch(true);
          setRegexSearch(true);
          setActiveMatchIndex(0);
          return;
        }
        setFindOpen(true);
        setFindFocusRequestId((id) => id + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [findOpen]);

  const focused = useMemo(() => {
    if (!focusNoiseFilter) {
      return { text: logText, hiddenCount: 0 };
    }
    return filterLogNoise(logText);
  }, [focusNoiseFilter, logText]);

  const viewText = focused.text;
  const hiddenNoiseCount = focused.hiddenCount;

  const logDisplay = useMemo(() => {
    if (displayFullLog) {
      return {
        text: viewText,
        truncated: viewText.length > MAX_LOG_VIEW_CHARACTERS,
        totalCharacters: viewText.length,
        showingFullContent: true
      };
    }
    const truncated = truncateLogTextForDisplay(viewText);
    return { ...truncated, showingFullContent: false };
  }, [displayFullLog, viewText]);

  const deferredLogText = useDeferredValue(logDisplay.text);
  const searchResult = useMemo(
    () => buildSearchResult(submittedSearch ? deferredLogText : logDisplay.text, submittedSearch, submittedRegexSearch),
    [deferredLogText, logDisplay.text, submittedRegexSearch, submittedSearch]
  );
  const matches = searchResult.matches;

  const activeMatchLabel = formatSearchMatchLabel(matches.length, activeMatchIndex, {
    truncated: searchResult.truncated,
    error: searchResult.error
  });

  const podLabelIndex = buildPodLabelIndex(tree);
  const breadcrumb = selectedItem
    ? formatLogBreadcrumb(selectedItem, podLabelIndex.get(`${selectedItem.type}:${selectedItem.pod}`) ?? 0)
    : undefined;
  const fullPath = selectedItem ? getLogFullPath(selectedItem, destination, activeSource) : undefined;
  const destinationItems = formatDestinationItems(activeSource, destination);

  useEffect(() => {
    setDisplayFullLog(false);
    setFindOpen(false);
    setSearchInput("");
    setSubmittedSearch("");
    setSubmittedRegexSearch(true);
    setRegexSearch(true);
    setActiveMatchIndex(0);
  }, [logText]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [submittedSearch, submittedRegexSearch, logDisplay.text]);

  useEffect(() => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => Math.min(current, matches.length - 1));
  }, [matches.length]);

  const submitLogSearch = () => {
    setSubmittedSearch(searchInput.trim());
    setSubmittedRegexSearch(regexSearch);
    setActiveMatchIndex(0);
  };

  const closeFind = () => {
    setFindOpen(false);
    setSearchInput("");
    setSubmittedSearch("");
    setSubmittedRegexSearch(true);
    setRegexSearch(true);
    setActiveMatchIndex(0);
  };

  const goToPreviousMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => (current === 0 ? matches.length - 1 : current - 1));
  };

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => (current + 1) % matches.length);
  };

  const handleFindEnter = () => {
    const query = searchInput.trim();
    const queryChanged = query !== submittedSearch || regexSearch !== submittedRegexSearch;
    if (queryChanged || !submittedSearch) {
      submitLogSearch();
      return;
    }
    if (matches.length > 0) {
      goToNextMatch();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <LogCommandBar
        activeSource={activeSource}
        onSourceChange={onSourceChange}
        sourceAvailability={sourceAvailability}
        breadcrumbSections={breadcrumb?.sections}
        breadcrumbFullPath={fullPath ?? breadcrumb?.fullPath}
        destinationItems={destinationItems}
        onDownload={onDownload}
        onCopyPath={() => {}}
        hasSelection={Boolean(selectedId)}
        focusNoiseFilter={focusNoiseFilter}
        onFocusNoiseFilterChange={setFocusNoiseFilter}
      />
      {errorMessage ? (
        <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {isLoading ? <p className="shrink-0 text-sm text-muted-foreground">{loadingMessage}</p> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        <LogFileTree
          tree={tree}
          selectedId={selectedId}
          onSelect={onSelect}
          collapsed={logFilesCollapsed}
          onToggleCollapsed={() => setLogFilesCollapsed((collapsed) => !collapsed)}
          collapseShortcut={LOG_FILES_TOGGLE_SHORTCUT}
        />
        <LogContentPanel
          logDisplay={logDisplay}
          hasSelection={Boolean(selectedId)}
          onLoadFullLog={() => setDisplayFullLog(true)}
          onDownload={onDownload}
          submittedSearch={submittedSearch}
          deferredLogText={deferredLogText}
          matches={matches}
          activeMatchIndex={activeMatchIndex}
          hiddenNoiseCount={hiddenNoiseCount}
          semanticHighlight={focusNoiseFilter}
          findOpen={findOpen}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          regexSearch={regexSearch}
          onRegexSearchChange={setRegexSearch}
          onSubmitSearch={handleFindEnter}
          onCloseFind={closeFind}
          resultLabel={activeMatchLabel}
          searchError={searchResult.error}
          onPreviousMatch={goToPreviousMatch}
          onNextMatch={goToNextMatch}
          searchDisabled={isLoading || !selectedId}
          findFocusRequestId={findFocusRequestId}
        />
      </div>
    </div>
  );
}
