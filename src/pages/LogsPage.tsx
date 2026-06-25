import { Archive, Cloud, Download } from "lucide-react";
import { memo, type FormEvent, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDescribeJobRun } from "@/hooks/useEmr";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useJobLogs, useJobLogStreams, useS3JobLogObject, useS3JobLogObjects } from "@/hooks/useLogs";
import { cn } from "@/lib/utils";
import { cloudWatchLogsService } from "@/services/cloudWatchLogsService";
import { buildEmrLogTree } from "@/services/emrLogTree";
import {
  defaultCloudWatchDestination,
  resolveJobLogDestinations,
  type CloudWatchLogDestination,
  type S3LogDestination
} from "@/services/jobLogDestinations";
import { saveTextFile } from "@/services/fileDownload";
import {
  buildSearchResult,
  formatSearchMatchLabel,
  selectRenderableMatches,
  type SearchMatch
} from "@/services/logSearch";
import { s3Service } from "@/services/s3Service";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError, JobLogObject, JobLogStream, JobLogTreeSection } from "@/types/domain";

export function LogsPage() {
  const selectedJobId = useSessionStore((state) => state.selectedJobId);
  const selectedJobVirtualClusterId = useSessionStore((state) => state.selectedJobVirtualClusterId);
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const setSelectedJobForLogs = useSessionStore((state) => state.setSelectedJobForLogs);
  const [jobIdInput, setJobIdInput] = useState(selectedJobId ?? "");
  const describedJob = useDescribeJobRun(selectedJobId, selectedJobVirtualClusterId ?? selectedVirtualClusterId);
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const destinations = useMemo(() => {
    if (!describedJob.data) return {};
    const resolved = resolveJobLogDestinations(describedJob.data);
    return resolved.cloudWatch || resolved.s3 ? resolved : { cloudWatch: defaultCloudWatchDestination(describedJob.data) };
  }, [describedJob.data]);
  const cloudWatchDestination = destinations.cloudWatch;
  const s3Destination = destinations.s3;
  const [activeSource, setActiveSource] = useState<"cloudwatch" | "s3" | undefined>();
  const resolvedActiveSource = activeSource ?? (s3Destination ? "s3" : cloudWatchDestination ? "cloudwatch" : "s3");

  useEffect(() => {
    setJobIdInput(selectedJobId ?? "");
  }, [selectedJobId]);
  useEffect(() => {
    setActiveSource(undefined);
  }, [selectedJobId]);
  const manualVirtualClusterId = selectedVirtualClusterId ?? selectedJobVirtualClusterId;
  const submitJobId = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedJobId = jobIdInput.trim();
    if (!trimmedJobId) return;
    setSelectedJobForLogs(trimmedJobId, manualVirtualClusterId);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Job Logs</CardTitle>
          <CardDescription>Browse EMR on EKS controller, driver, and executor logs from CloudWatch or S3 archives.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-col gap-2 rounded-md border bg-secondary/40 p-3 sm:flex-row sm:items-center" onSubmit={submitJobId}>
            <Input
              className="sm:max-w-md"
              placeholder="Enter job id"
              value={jobIdInput}
              onChange={(event) => setJobIdInput(event.target.value)}
            />
            <Button type="submit" disabled={!jobIdInput.trim() || !manualVirtualClusterId}>
              View Logs
            </Button>
            <span className="text-xs text-muted-foreground">
              Virtual cluster: <span className="font-medium">{manualVirtualClusterId ?? "select one first"}</span>
            </span>
          </form>
          {!selectedJobId ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Select a job from Job History or enter a job id to view logs.
            </p>
          ) : null}
          {describedJob.isLoading ? <p className="text-sm text-muted-foreground">Loading job log configuration...</p> : null}
          {describedJob.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage(describedJob.error)}
            </p>
          ) : null}
          {!describedJob.isLoading && selectedJobId && !cloudWatchDestination && !s3Destination ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No CloudWatch or S3 monitoring configuration was found for this job.
            </p>
          ) : null}
          <Tabs
            value={resolvedActiveSource}
            onValueChange={(value) => {
              setActiveSource(value as "cloudwatch" | "s3");
            }}
          >
            <TabsList>
              <TabsTrigger value="s3" disabled={!s3Destination}>
                <Archive data-icon="inline-start" />
                S3
              </TabsTrigger>
              <TabsTrigger value="cloudwatch" disabled={!cloudWatchDestination}>
                <Cloud data-icon="inline-start" />
                CloudWatch
              </TabsTrigger>
            </TabsList>
            <TabsContent value="s3" className="mt-4">
              {resolvedActiveSource === "s3" && s3Destination && selectedJobId ? (
                <S3LogsTab key={selectedJobId} destination={s3Destination} selectedJobId={selectedJobId} accountId={accountId} />
              ) : null}
            </TabsContent>
            <TabsContent value="cloudwatch" className="mt-4">
              {resolvedActiveSource === "cloudwatch" && cloudWatchDestination && selectedJobId ? (
                <CloudWatchLogsTab
                  key={selectedJobId}
                  destination={cloudWatchDestination}
                  selectedJobId={selectedJobId}
                  accountId={accountId}
                />
              ) : null}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function S3LogsTab({
  destination,
  selectedJobId,
  accountId
}: {
  destination: S3LogDestination;
  selectedJobId: string;
  accountId?: string;
}) {
  const [selectedS3Key, setSelectedS3Key] = useState<string>();
  const s3LogObjects = useS3JobLogObjects({
    bucket: destination.bucket,
    prefix: destination.prefix
  });
  const s3LogObject = useS3JobLogObject(destination.bucket, selectedS3Key);
  const s3Tree = useMemo(() => buildEmrLogTree(s3LogObjects.data?.objects ?? []), [s3LogObjects.data?.objects]);
  const selectedS3Item = useMemo(
    () => s3LogObjects.data?.objects.find((object) => object.s3Key === selectedS3Key),
    [s3LogObjects.data?.objects, selectedS3Key]
  );

  useEffect(() => {
    if (!selectedS3Key && s3LogObjects.data?.objects[0]) {
      setSelectedS3Key(s3LogObjects.data.objects[0].s3Key);
    }
  }, [s3LogObjects.data?.objects, selectedS3Key]);

  const downloadSelectedLog = async () => {
    if (!selectedS3Item?.label) return;
    try {
      const chunk = await getDownloadChunk(selectedS3Item, selectedJobId, accountId, undefined, destination);
      const savedPath = await saveTextFile(`${selectedJobId}-${selectedS3Item.label}.log`, chunk);
      if (savedPath) {
        toast.success(`Saved to ${savedPath}`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <LogDestinationSummary items={[["S3 archive prefix", `s3://${destination.bucket}/${destination.prefix}`]]} />
      {s3LogObjects.isLoading || s3LogObject.isLoading ? <p className="text-sm text-muted-foreground">Loading S3 archive logs...</p> : null}
      {s3LogObjects.error || s3LogObject.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage(s3LogObjects.error ?? s3LogObject.error)}
        </p>
      ) : null}
      <LogViewerLayout
        tree={s3Tree}
        selectedId={selectedS3Key}
        onSelect={(item) => setSelectedS3Key((item as JobLogObject).s3Key)}
        onDownloadSelected={downloadSelectedLog}
        selectedLabel={selectedS3Item?.label}
        path={selectedS3Item ? `s3://${destination.bucket}/${selectedS3Item.s3Key}` : undefined}
        logText={s3LogObject.data?.content ?? ""}
      />
    </>
  );
}

function CloudWatchLogsTab({
  destination,
  selectedJobId,
  accountId
}: {
  destination: CloudWatchLogDestination;
  selectedJobId: string;
  accountId?: string;
}) {
  const [selectedCloudWatchStream, setSelectedCloudWatchStream] = useState<string>();
  const logStreams = useJobLogStreams({
    jobId: selectedJobId,
    logGroupName: destination.logGroupName,
    streamNamePrefix: destination.streamNamePrefix ?? ""
  });
  const logs = useJobLogs(
    selectedCloudWatchStream
      ? {
          jobId: selectedJobId,
          logGroupName: destination.logGroupName,
          streamNamePrefix: destination.streamNamePrefix,
          logStreamName: selectedCloudWatchStream
        }
      : undefined
  );
  const cloudWatchTree = useMemo(() => buildEmrLogTree(logStreams.data?.streams ?? []), [logStreams.data?.streams]);
  const selectedCloudWatchItem = useMemo(
    () => logStreams.data?.streams.find((stream) => stream.cloudWatchStreamName === selectedCloudWatchStream),
    [logStreams.data?.streams, selectedCloudWatchStream]
  );

  const downloadSelectedLog = async () => {
    if (!selectedCloudWatchItem?.label) return;
    try {
      const chunk = await getDownloadChunk(selectedCloudWatchItem, selectedJobId, accountId, destination);
      const savedPath = await saveTextFile(`${selectedJobId}-${selectedCloudWatchItem.label}.log`, chunk);
      if (savedPath) {
        toast.success(`Saved to ${savedPath}`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <LogDestinationSummary
        items={[
          ["Log group", destination.logGroupName],
          ["Stream prefix", destination.streamNamePrefix]
        ]}
      />
      {logStreams.isLoading || logs.isLoading ? <p className="text-sm text-muted-foreground">Loading CloudWatch logs...</p> : null}
      {logStreams.error || logs.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage(logStreams.error ?? logs.error)}
        </p>
      ) : null}
      <LogViewerLayout
        tree={cloudWatchTree}
        selectedId={selectedCloudWatchStream}
        onSelect={(item) => setSelectedCloudWatchStream((item as JobLogStream).cloudWatchStreamName)}
        onDownloadSelected={downloadSelectedLog}
        selectedLabel={selectedCloudWatchItem?.label}
        path={selectedCloudWatchItem?.cloudWatchStreamName}
        logText={formatCloudWatchMessages(logs.data?.entries ?? [])}
      />
    </>
  );
}

function LogDestinationSummary({ items }: { items: Array<[string, string | undefined]> }) {
  return (
    <div className="mb-4 grid gap-2 rounded-md border bg-secondary/40 p-3 text-sm">
      {items.map(([label, value]) => (
        <div key={label}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="break-all font-medium">{value || "-"}</div>
        </div>
      ))}
    </div>
  );
}

const LogViewerLayout = memo(function LogViewerLayout({
  tree,
  selectedId,
  onSelect,
  onDownloadSelected,
  selectedLabel,
  path,
  logText
}: {
  tree: JobLogTreeSection[];
  selectedId?: string;
  onSelect: (item: JobLogStream | JobLogObject) => void;
  onDownloadSelected: () => void;
  selectedLabel?: string;
  path?: string;
  logText: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [regexSearch, setRegexSearch] = useState(false);
  const [submittedRegexSearch, setSubmittedRegexSearch] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredLogText = useDeferredValue(logText);
  const searchResult = useMemo(
    () => buildSearchResult(submittedSearch ? deferredLogText : logText, submittedSearch, submittedRegexSearch),
    [deferredLogText, logText, submittedRegexSearch, submittedSearch]
  );
  const matches = searchResult.matches;
  const highlightedLogContent = useMemo(() => {
    if (!logText) return "Select a log to view its content.";
    if (!submittedSearch) return logText;
    return renderHighlightedLogText(deferredLogText, matches, activeMatchIndex);
  }, [activeMatchIndex, deferredLogText, logText, matches, submittedSearch]);
  const activeMatchLabel = formatSearchMatchLabel(matches.length, activeMatchIndex, {
    truncated: searchResult.truncated,
    error: searchResult.error
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "f" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [searchOpen]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [submittedSearch, submittedRegexSearch, logText]);

  const submitLogSearch = () => {
    setSubmittedSearch(searchInput.trim());
    setSubmittedRegexSearch(regexSearch);
    setActiveMatchIndex(0);
  };

  useEffect(() => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => Math.min(current, matches.length - 1));
  }, [matches.length]);

  useEffect(() => {
    const activeMatch = document.querySelector('[data-active-log-search-match="true"]') as HTMLElement | null;
    activeMatch?.scrollIntoView?.({ block: "center" });
  }, [activeMatchIndex, matches]);

  const goToPreviousMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => (current === 0 ? matches.length - 1 : current - 1));
  };

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => (current + 1) % matches.length);
  };

  return (
    <div className="grid grid-cols-[360px_1fr] gap-4">
      <div className="rounded-md border">
        <div className="border-b p-3">
          <div className="font-medium">Log files</div>
          <div className="text-xs text-muted-foreground">Controller, driver, executor stdout/stderr</div>
        </div>
        <ScrollArea className="h-[560px] p-2">
          {tree.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No log streams found for this job.</p> : null}
          {tree.map((section) => (
            <div key={section.type} className="mb-3">
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </div>
              {section.groups.map((group) => (
                <div key={group.label} className="mb-2">
                  <div className="break-all px-2 py-1 text-xs text-muted-foreground">
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "mb-1 flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                        item.id === selectedId ? "bg-primary text-primary-foreground hover:bg-primary" : undefined
                      )}
                      onClick={() => onSelect(item)}
                    >
                      <span className="font-medium">{item.stream}</span>
                      <span className={cn("text-xs", item.id === selectedId ? "text-primary-foreground/80" : "text-muted-foreground")}>
                        {item.source === "s3" ? formatBytes((item as JobLogObject).size) : "live"}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </ScrollArea>
      </div>
      <div className="min-w-0 rounded-md border">
        <div className="border-b p-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 truncate font-medium">{selectedLabel ?? "Select a log"}</div>
            {selectedLabel ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Download selected log"
                onClick={() => void onDownloadSelected()}
              >
                <Download />
              </Button>
            ) : null}
          </div>
          <div className="break-all text-xs text-muted-foreground">{path ?? "Choose a stdout or stderr entry from the log tree."}</div>
        </div>
        {searchOpen ? (
          <div className="flex flex-wrap items-center gap-2 border-b bg-secondary/30 p-2">
            <Input
              ref={searchInputRef}
              className="h-8 min-w-48 flex-1"
              placeholder="Find in this log (press Enter)"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitLogSearch();
                }
              }}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-4"
                aria-label="Regex"
                checked={regexSearch}
                onChange={(event) => setRegexSearch(event.target.checked)}
              />
              Regex
            </label>
            <span className={cn("min-w-16 text-xs", searchResult.error ? "text-destructive" : "text-muted-foreground")}>
              {submittedSearch ? activeMatchLabel : "Press Enter"}
            </span>
            <Button type="button" variant="outline" size="sm" aria-label="Previous match" disabled={matches.length === 0} onClick={goToPreviousMatch}>
              Previous
            </Button>
            <Button type="button" variant="outline" size="sm" aria-label="Next match" disabled={matches.length === 0} onClick={goToNextMatch}>
              Next
            </Button>
          </div>
        ) : null}
        <ScrollArea className="h-[560px] bg-slate-950 p-4">
          <pre data-testid="log-content" className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-100">
            {highlightedLogContent}
          </pre>
        </ScrollArea>
      </div>
    </div>
  );
});

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function getDownloadChunk(
  item: JobLogStream | JobLogObject,
  jobId: string,
  accountId: string | undefined,
  cloudWatchDestination?: CloudWatchLogDestination,
  s3Destination?: S3LogDestination
) {
  if (item.source === "cloudwatch") {
    if (!cloudWatchDestination) {
      throw new Error("CloudWatch log configuration is unavailable.");
    }
    const lines = await getCloudWatchDownloadLines(item, jobId, cloudWatchDestination);
    return [item.cloudWatchStreamName, ...lines].join("\n");
  }

  if (!s3Destination) {
    throw new Error("S3 log configuration is unavailable.");
  }
  const response = await s3Service.getJobLogObject(accountId!, s3Destination.bucket, item.s3Key);
  return [`s3://${s3Destination.bucket}/${item.s3Key}`, response.content].join("\n");
}

async function getCloudWatchDownloadLines(item: JobLogStream, jobId: string, cloudWatchDestination: CloudWatchLogDestination) {
  const lines: string[] = [];
  let nextForwardToken: string | undefined;

  do {
    const requestToken = nextForwardToken;
    const response = await cloudWatchLogsService.getJobLogs({
      jobId,
      logGroupName: cloudWatchDestination.logGroupName,
      streamNamePrefix: cloudWatchDestination.streamNamePrefix,
      logStreamName: item.cloudWatchStreamName,
      nextForwardToken,
      limit: 10_000
    });
    lines.push(...response.entries.map((entry) => entry.message ?? ""));
    nextForwardToken = response.nextForwardToken && response.nextForwardToken !== requestToken ? response.nextForwardToken : undefined;
  } while (nextForwardToken);

  return lines;
}

function formatCloudWatchMessages(entries: Array<{ message?: string }>) {
  return entries.map((entry) => entry.message ?? "").join("\n");
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

function errorMessage(error: unknown) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "Logs require the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? "Failed to load logs.";
}
