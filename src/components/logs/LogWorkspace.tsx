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
import { buildSearchResult, formatSearchMatchLabel } from "@/services/logSearch";
import type { CloudWatchLogDestination, S3LogDestination } from "@/services/jobLogDestinations";
import type { JobLogObject, JobLogStream, JobLogTreeSection } from "@/types/domain";

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
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [regexSearch, setRegexSearch] = useState(false);
  const [submittedRegexSearch, setSubmittedRegexSearch] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [displayFullLog, setDisplayFullLog] = useState(false);

  const logDisplay = useMemo(() => {
    if (displayFullLog) {
      return {
        text: logText,
        truncated: logText.length > MAX_LOG_VIEW_CHARACTERS,
        totalCharacters: logText.length,
        showingFullContent: true
      };
    }
    const truncated = truncateLogTextForDisplay(logText);
    return { ...truncated, showingFullContent: false };
  }, [displayFullLog, logText]);

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
    setSearchInput("");
    setSubmittedSearch("");
    setSubmittedRegexSearch(false);
    setRegexSearch(false);
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

  const goToPreviousMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => (current === 0 ? matches.length - 1 : current - 1));
  };

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => (current + 1) % matches.length);
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
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        regexSearch={regexSearch}
        onRegexSearchChange={setRegexSearch}
        onSubmitSearch={submitLogSearch}
        submittedSearch={submittedSearch}
        activeMatchLabel={activeMatchLabel}
        searchError={searchResult.error}
        matchesCount={matches.length}
        onPreviousMatch={goToPreviousMatch}
        onNextMatch={goToNextMatch}
        onDownload={onDownload}
        onCopyPath={() => {}}
        searchDisabled={isLoading || !selectedId}
        hasSelection={Boolean(selectedId)}
      />
      {errorMessage ? (
        <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {isLoading ? <p className="shrink-0 text-sm text-muted-foreground">{loadingMessage}</p> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        <LogFileTree tree={tree} selectedId={selectedId} onSelect={onSelect} />
        <LogContentPanel
          logDisplay={logDisplay}
          hasSelection={Boolean(selectedId)}
          onLoadFullLog={() => setDisplayFullLog(true)}
          onDownload={onDownload}
          submittedSearch={submittedSearch}
          deferredLogText={deferredLogText}
          matches={matches}
          activeMatchIndex={activeMatchIndex}
        />
      </div>
    </div>
  );
}
