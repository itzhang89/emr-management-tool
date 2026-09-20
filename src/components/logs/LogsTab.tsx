import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { LogsEmptyState } from "@/components/logs/LogsEmptyState";
import { LogWorkspace } from "@/components/logs/LogWorkspace";
import { RecentSearchInput, type RecentSearchInputHandle } from "@/components/search/RecentSearchInput";
import { Badge } from "@/components/ui/badge";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useDescribeJobRun, useVirtualClusters } from "@/hooks/useEmr";
import { useJobLogs, useJobLogStreams, useS3JobLogObject, useS3JobLogObjects } from "@/hooks/useLogs";
import { localeTag, useLocale, useT } from "@/i18n";
import { isFocusSearchKey } from "@/lib/keyboardShortcut";
import { cloudWatchLogsService } from "@/services/cloudWatchLogsService";
import { buildEmrLogTree, pickDefaultLogItem } from "@/services/emrLogTree";
import { saveTextFile } from "@/services/fileDownload";
import { formatCloudWatchMessages } from "@/services/logDisplay";
import {
  defaultCloudWatchDestination,
  resolveJobLogDestinations,
  type CloudWatchLogDestination,
  type S3LogDestination
} from "@/services/jobLogDestinations";
import { normalizeEmrJobRunId } from "@/services/emrJobId";
import { readLogsJobIdSearchHistory } from "@/services/logsJobIdSearchHistory";
import type { CachedLogContent } from "@/services/logsTabStorage";
import { s3Service } from "@/services/s3Service";
import type { AppError, JobLogObject, JobLogStream } from "@/types/domain";

/** The selection a tab already had when it was restored from the local cache. */
export interface LogsTabRestoredState {
  activeSource?: "s3" | "cloudwatch";
  s3SelectedKey?: string;
  cloudWatchSelectedStream?: string;
}

/** What the tab reports upward so the workspace can persist it. */
export interface LogsTabSnapshot extends LogsTabRestoredState {
  jobName?: string;
  content?: CachedLogContent;
}

/**
 * One job's logs, as a tab inside the Job History workspace.
 *
 * This is the old standalone Logs page with its surroundings moved out: the job
 * comes in as a prop instead of from the session store (a tab is a fixed
 * `(job, cluster)` pair — nothing about it changes while it is open), the page
 * chrome is a one-line job header instead of a page title, and the tab reports
 * its selection and the text it fetched so the workspace can cache them.
 *
 * A tab with no `jobId` is a draft: the job id box and the empty state, which
 * is how a job the list does not show is still reachable. Submitting an id
 * hands it to the workspace, which turns the draft into a real tab.
 */
export function LogsTab({
  active,
  jobId,
  virtualClusterId,
  restored,
  cachedContent,
  onSnapshot,
  onOpenJob
}: {
  /** Whether this tab is the one on screen — gates the window-wide shortcuts. */
  active: boolean;
  /** Undefined while the tab is still a draft. */
  jobId?: string;
  virtualClusterId?: string;
  restored?: LogsTabRestoredState;
  /** Text this tab was last showing, read back from the local cache. */
  cachedContent?: CachedLogContent;
  onSnapshot?: (snapshot: LogsTabSnapshot) => void;
  /** Take over this draft tab for a job id the user typed or picked. */
  onOpenJob?: (jobId: string, virtualClusterId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const clusters = useVirtualClusters();
  const clusterId = virtualClusterId ?? effectiveVirtualClusterId;
  const [jobIdInput, setJobIdInput] = useState(jobId ?? "");
  const [recentJobIdSearches, setRecentJobIdSearches] = useState<string[]>([]);
  const jobIdInputRef = useRef<RecentSearchInputHandle>(null);
  const describedJob = useDescribeJobRun(jobId, clusterId);
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const destinations = useMemo(() => {
    if (!describedJob.data) return {};
    const resolved = resolveJobLogDestinations(describedJob.data);
    return resolved.cloudWatch || resolved.s3 ? resolved : { cloudWatch: defaultCloudWatchDestination(describedJob.data) };
  }, [describedJob.data]);
  const cloudWatchDestination = destinations.cloudWatch;
  const s3Destination = destinations.s3;
  const hasDestinations = Boolean(cloudWatchDestination || s3Destination);
  const [activeSource, setActiveSource] = useState<"cloudwatch" | "s3" | undefined>(restored?.activeSource);
  const [visitedSources, setVisitedSources] = useState<Set<"cloudwatch" | "s3">>(
    () => new Set(restored?.activeSource ? [restored.activeSource] : [])
  );
  const [s3SelectedKey, setS3SelectedKey] = useState<string | undefined>(restored?.s3SelectedKey);
  const [cloudWatchSelectedStream, setCloudWatchSelectedStream] = useState<string | undefined>(
    restored?.cloudWatchSelectedStream
  );
  const [, startTabTransition] = useTransition();
  const resolvedActiveSource = activeSource ?? (s3Destination ? "s3" : cloudWatchDestination ? "cloudwatch" : "s3");
  const cachedText = cachedContent?.text;

  useEffect(() => {
    setRecentJobIdSearches(accountId ? readLogsJobIdSearchHistory(accountId) : []);
  }, [accountId]);

  useEffect(() => {
    if (!jobId) return;
    setJobIdInput(jobId);
  }, [jobId]);

  useEffect(() => {
    setVisitedSources((current) => {
      if (current.has(resolvedActiveSource)) {
        return current;
      }
      const next = new Set(current);
      next.add(resolvedActiveSource);
      return next;
    });
  }, [resolvedActiveSource]);

  // Report upward only what the workspace cannot see for itself. The content is
  // reported wherever it is fetched, not from the cached fallback, so restoring
  // a tab never rewrites the cache with the copy it just read.
  useEffect(() => {
    if (describedJob.data?.name) {
      onSnapshot?.({ jobName: describedJob.data.name });
    }
  }, [describedJob.data?.name, onSnapshot]);

  useEffect(() => {
    onSnapshot?.({ activeSource });
  }, [activeSource, onSnapshot]);

  useEffect(() => {
    onSnapshot?.({ s3SelectedKey, cloudWatchSelectedStream });
  }, [s3SelectedKey, cloudWatchSelectedStream, onSnapshot]);

  const openJob = (rawQuery: string) => {
    const original = rawQuery.trim();
    if (!original || !clusterId) return;
    const normalizedJobId = normalizeEmrJobRunId(original);
    setJobIdInput(normalizedJobId);
    onOpenJob?.(normalizedJobId, clusterId);
  };

  // The job id box only exists when there is no viewer to search in, which is
  // also when the old Logs page claimed Mod+F for it. A tab that is not on
  // screen stays out of the way — several tabs are mounted at once.
  useEffect(() => {
    if (!active || jobId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isFocusSearchKey(event)) return;
      event.preventDefault();
      jobIdInputRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, jobId]);

  if (!jobId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <RecentSearchInput
            ref={jobIdInputRef}
            value={jobIdInput}
            onChange={setJobIdInput}
            onSubmit={openJob}
            recentSearches={recentJobIdSearches}
            placeholder={t("Enter job id")}
            title={jobIdInput}
            inputClassName="font-mono text-sm"
            listLabel={t("Recent job ids")}
          />
          <VirtualClusterSelect />
        </div>
        <LogsEmptyState recentJobIds={recentJobIdSearches} onSelectJobId={openJob} />
      </div>
    );
  }

  const sourceAvailability = {
    s3: Boolean(s3Destination),
    cloudwatch: Boolean(cloudWatchDestination)
  };
  const clusterName = clusters.data?.clusters.find((cluster) => cluster.id === clusterId)?.name;
  // A job we cannot describe is still a job whose logs we may have on disk.
  // Showing the cached copy beats showing an error, which is the whole reason
  // the text is cached at all.
  const showCachedOnly = Boolean(cachedText && describedJob.error);
  const showViewer = Boolean(hasDestinations && !describedJob.isLoading && !describedJob.error);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-medium">{describedJob.data?.name ?? jobId}</span>
        <span className="font-mono text-xs text-muted-foreground">{jobId}</span>
        {describedJob.data?.state ? (
          <Badge variant="secondary" className="text-xs">
            {describedJob.data.state}
          </Badge>
        ) : null}
        {clusterName ? <span className="truncate text-xs text-muted-foreground">{clusterName}</span> : null}
      </div>

      {describedJob.isLoading ? (
        <p className="shrink-0 text-sm text-muted-foreground">{t("Loading job log configuration...")}</p>
      ) : null}

      {describedJob.error && !showCachedOnly ? (
        <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage(describedJob.error)}
        </p>
      ) : null}

      {showCachedOnly && cachedContent ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-md border bg-card p-3">
          <p className="shrink-0 text-xs text-muted-foreground">
            {t("Offline copy saved {savedAt} — {reason}", {
              savedAt: new Date(cachedContent.savedAt).toLocaleString(localeTag(locale)),
              reason: errorMessage(describedJob.error)
            })}
          </p>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap font-mono text-xs">
            {cachedContent.text}
          </pre>
        </div>
      ) : null}

      {!describedJob.isLoading && !describedJob.error && !hasDestinations ? (
        <p className="shrink-0 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t("No CloudWatch or S3 monitoring configuration was found for this job.")}
        </p>
      ) : null}

      {showViewer && s3Destination && (visitedSources.has("s3") || resolvedActiveSource === "s3") ? (
        <S3LogsSource
          active={active}
          hidden={resolvedActiveSource !== "s3"}
          isActive={resolvedActiveSource === "s3"}
          destination={s3Destination}
          jobId={jobId}
          accountId={accountId}
          selectedKey={s3SelectedKey}
          onSelectedKeyChange={setS3SelectedKey}
          cachedContent={cachedContent}
          onContent={onSnapshot}
          activeSource={resolvedActiveSource}
          onSourceChange={(source) => startTabTransition(() => setActiveSource(source))}
          sourceAvailability={sourceAvailability}
        />
      ) : null}

      {showViewer && cloudWatchDestination && (visitedSources.has("cloudwatch") || resolvedActiveSource === "cloudwatch") ? (
        <CloudWatchLogsSource
          active={active}
          hidden={resolvedActiveSource !== "cloudwatch"}
          isActive={resolvedActiveSource === "cloudwatch"}
          destination={cloudWatchDestination}
          jobId={jobId}
          accountId={accountId}
          selectedStream={cloudWatchSelectedStream}
          onSelectedStreamChange={setCloudWatchSelectedStream}
          cachedContent={cachedContent}
          onContent={onSnapshot}
          activeSource={resolvedActiveSource}
          onSourceChange={(source) => startTabTransition(() => setActiveSource(source))}
          sourceAvailability={sourceAvailability}
        />
      ) : null}
    </div>
  );
}

function S3LogsSource({
  active,
  hidden,
  isActive,
  destination,
  jobId,
  accountId,
  selectedKey,
  onSelectedKeyChange,
  cachedContent,
  onContent,
  activeSource,
  onSourceChange,
  sourceAvailability
}: {
  /** The tab is on screen — a hidden tab's ⌘F must not reach this workspace. */
  active: boolean;
  /** The other source is front-most; this pane is mounted but not rendered. */
  hidden: boolean;
  isActive: boolean;
  destination: S3LogDestination;
  jobId: string;
  accountId?: string;
  selectedKey?: string;
  onSelectedKeyChange: (key: string | undefined) => void;
  cachedContent?: CachedLogContent;
  onContent?: (snapshot: LogsTabSnapshot) => void;
  activeSource: "s3" | "cloudwatch";
  onSourceChange: (source: "s3" | "cloudwatch") => void;
  sourceAvailability: { s3: boolean; cloudwatch: boolean };
}) {
  const t = useT();
  // Only the front-most source fetches: a job with both destinations would
  // otherwise pull its whole S3 archive the moment the tab opens. The pane
  // stays mounted either way, so the query it already ran stays warm and
  // switching sources is instant.
  const s3LogObjects = useS3JobLogObjects(
    isActive
      ? {
          bucket: destination.bucket,
          prefix: destination.prefix
        }
      : undefined
  );
  const objects = s3LogObjects.data?.objects ?? [];
  const resolvedSelectedKey = selectedKey ?? pickDefaultLogItem(objects)?.s3Key;
  const s3LogObject = useS3JobLogObject(isActive ? destination.bucket : undefined, isActive ? resolvedSelectedKey : undefined);
  const s3Tree = useMemo(() => buildEmrLogTree(objects), [objects]);
  const selectedS3Item = useMemo(
    () => objects.find((object) => object.s3Key === resolvedSelectedKey),
    [objects, resolvedSelectedKey]
  );
  const liveText = s3LogObject.data?.content;
  // The cached copy belongs to one item; showing it under another item's title
  // would be worse than showing nothing.
  const cachedForItem =
    cachedContent && cachedContent.itemKey === resolvedSelectedKey ? cachedContent.text : undefined;

  useEffect(() => {
    if (!selectedKey || !objects.length) return;
    if (!objects.some((object) => object.s3Key === selectedKey)) {
      onSelectedKeyChange(undefined);
    }
  }, [objects, onSelectedKeyChange, selectedKey]);

  useEffect(() => {
    if (!resolvedSelectedKey || liveText === undefined) return;
    onContent?.({
      content: { itemKey: resolvedSelectedKey, text: liveText, savedAt: new Date().toISOString() }
    });
  }, [liveText, onContent, resolvedSelectedKey]);

  const downloadSelectedLog = async () => {
    if (!selectedS3Item?.label) return;
    try {
      const chunk = await getDownloadChunk(selectedS3Item, jobId, accountId, undefined, destination);
      const savedPath = await saveTextFile(`${jobId}-${selectedS3Item.label}.log`, chunk);
      if (savedPath) {
        toast.success(t("Saved to {path}", { path: savedPath }));
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (hidden) return null;

  return (
    <LogWorkspace
      active={active}
      activeSource={activeSource}
      onSourceChange={onSourceChange}
      sourceAvailability={sourceAvailability}
      destination={destination}
      tree={s3Tree}
      selectedId={resolvedSelectedKey}
      selectedItem={selectedS3Item}
      logText={liveText ?? cachedForItem ?? ""}
      isLoading={s3LogObjects.isLoading || s3LogObject.isLoading}
      loadingMessage={t("Loading S3 archive logs...")}
      errorMessage={
        s3LogObjects.error || s3LogObject.error ? errorMessage(s3LogObjects.error ?? s3LogObject.error) : undefined
      }
      onSelect={(item) => onSelectedKeyChange((item as JobLogObject).s3Key)}
      onDownload={() => void downloadSelectedLog()}
    />
  );
}

function CloudWatchLogsSource({
  active,
  hidden,
  isActive,
  destination,
  jobId,
  accountId,
  selectedStream,
  onSelectedStreamChange,
  cachedContent,
  onContent,
  activeSource,
  onSourceChange,
  sourceAvailability
}: {
  active: boolean;
  hidden: boolean;
  isActive: boolean;
  destination: CloudWatchLogDestination;
  jobId: string;
  accountId?: string;
  selectedStream?: string;
  onSelectedStreamChange: (stream: string | undefined) => void;
  cachedContent?: CachedLogContent;
  onContent?: (snapshot: LogsTabSnapshot) => void;
  activeSource: "s3" | "cloudwatch";
  onSourceChange: (source: "s3" | "cloudwatch") => void;
  sourceAvailability: { s3: boolean; cloudwatch: boolean };
}) {
  const t = useT();
  const logStreams = useJobLogStreams(
    isActive
      ? {
          jobId,
          logGroupName: destination.logGroupName,
          streamNamePrefix: destination.streamNamePrefix ?? ""
        }
      : undefined
  );
  const streams = logStreams.data?.streams ?? [];
  const resolvedSelectedStream = selectedStream ?? pickDefaultLogItem(streams)?.cloudWatchStreamName;
  const logs = useJobLogs(
    isActive && resolvedSelectedStream
      ? {
          jobId,
          logGroupName: destination.logGroupName,
          streamNamePrefix: destination.streamNamePrefix,
          logStreamName: resolvedSelectedStream
        }
      : undefined
  );
  const cloudWatchLogText = useMemo(() => formatCloudWatchMessages(logs.data?.entries ?? []), [logs.data?.entries]);
  const cloudWatchTree = useMemo(() => buildEmrLogTree(streams), [streams]);
  const selectedCloudWatchItem = useMemo(
    () => streams.find((stream) => stream.cloudWatchStreamName === resolvedSelectedStream),
    [streams, resolvedSelectedStream]
  );
  const hasLiveText = Boolean(logs.data);
  const cachedForStream =
    cachedContent && cachedContent.itemKey === resolvedSelectedStream ? cachedContent.text : undefined;

  useEffect(() => {
    if (!selectedStream || !streams.length) return;
    if (!streams.some((stream) => stream.cloudWatchStreamName === selectedStream)) {
      onSelectedStreamChange(undefined);
    }
  }, [onSelectedStreamChange, selectedStream, streams]);

  useEffect(() => {
    if (!resolvedSelectedStream || !hasLiveText) return;
    onContent?.({
      content: { itemKey: resolvedSelectedStream, text: cloudWatchLogText, savedAt: new Date().toISOString() }
    });
  }, [cloudWatchLogText, hasLiveText, onContent, resolvedSelectedStream]);

  const downloadSelectedLog = async () => {
    if (!selectedCloudWatchItem?.label) return;
    try {
      const chunk = await getDownloadChunk(selectedCloudWatchItem, jobId, accountId, destination);
      const savedPath = await saveTextFile(`${jobId}-${selectedCloudWatchItem.label}.log`, chunk);
      if (savedPath) {
        toast.success(t("Saved to {path}", { path: savedPath }));
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (hidden) return null;

  return (
    <LogWorkspace
      active={active}
      activeSource={activeSource}
      onSourceChange={onSourceChange}
      sourceAvailability={sourceAvailability}
      destination={destination}
      tree={cloudWatchTree}
      selectedId={resolvedSelectedStream}
      selectedItem={selectedCloudWatchItem}
      logText={hasLiveText ? cloudWatchLogText : (cachedForStream ?? "")}
      isLoading={logStreams.isLoading || logs.isLoading}
      loadingMessage={t("Loading CloudWatch logs...")}
      errorMessage={logStreams.error || logs.error ? errorMessage(logStreams.error ?? logs.error) : undefined}
      onSelect={(item) => onSelectedStreamChange((item as JobLogStream).cloudWatchStreamName)}
      onDownload={() => void downloadSelectedLog()}
    />
  );
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

/**
 * Downloads deliberately re-read every page from CloudWatch instead of serving
 * the text already on screen: the user asked for the whole log, and the cached
 * copy is a bounded slice of it.
 */
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

function errorMessage(error: unknown) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "Logs require the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? "Failed to load logs.";
}
