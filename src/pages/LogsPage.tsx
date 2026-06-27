import { Search } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { LogWorkspace } from "@/components/logs/LogWorkspace";
import { LogsEmptyState } from "@/components/logs/LogsEmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { useDescribeJobRun, useVirtualClusters } from "@/hooks/useEmr";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useJobLogs, useJobLogStreams, useS3JobLogObject, useS3JobLogObjects } from "@/hooks/useLogs";
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
import { s3Service } from "@/services/s3Service";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError, JobLogObject, JobLogStream } from "@/types/domain";

export function LogsPage() {
  const selectedJobId = useSessionStore((state) => state.selectedJobId);
  const selectedJobVirtualClusterId = useSessionStore((state) => state.selectedJobVirtualClusterId);
  const setSelectedVirtualClusterId = useSessionStore((state) => state.setSelectedVirtualClusterId);
  const setSelectedJobForLogs = useSessionStore((state) => state.setSelectedJobForLogs);
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const clusters = useVirtualClusters();
  const [jobIdInput, setJobIdInput] = useState(selectedJobId ?? "");
  const describedJob = useDescribeJobRun(selectedJobId, selectedJobVirtualClusterId ?? effectiveVirtualClusterId);
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
  const [activeSource, setActiveSource] = useState<"cloudwatch" | "s3" | undefined>();
  const [visitedSources, setVisitedSources] = useState<Set<"cloudwatch" | "s3">>(() => new Set());
  const [s3SelectedKey, setS3SelectedKey] = useState<string>();
  const [cloudWatchSelectedStream, setCloudWatchSelectedStream] = useState<string>();
  const [, startTabTransition] = useTransition();
  const resolvedActiveSource = activeSource ?? (s3Destination ? "s3" : cloudWatchDestination ? "cloudwatch" : "s3");

  useEffect(() => {
    setJobIdInput(selectedJobId ?? "");
  }, [selectedJobId]);

  useEffect(() => {
    setActiveSource(undefined);
    setVisitedSources(new Set());
    setS3SelectedKey(undefined);
    setCloudWatchSelectedStream(undefined);
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJobVirtualClusterId || !clusters.data?.clusters.length) return;
    const matched = clusters.data.clusters.some((cluster) => cluster.id === selectedJobVirtualClusterId);
    if (matched) {
      setSelectedVirtualClusterId(selectedJobVirtualClusterId);
    }
  }, [selectedJobId, selectedJobVirtualClusterId, clusters.data?.clusters, setSelectedVirtualClusterId]);

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

  const submitJobId = () => {
    const trimmedJobId = jobIdInput.trim();
    if (!trimmedJobId || !effectiveVirtualClusterId) return;
    setSelectedJobForLogs(trimmedJobId, effectiveVirtualClusterId);
  };

  const sourceAvailability = {
    s3: Boolean(s3Destination),
    cloudwatch: Boolean(cloudWatchDestination)
  };

  const showViewer = Boolean(selectedJobId && hasDestinations && !describedJob.isLoading && !describedJob.error);

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col gap-4 overflow-hidden">
      <PageHeader
        pageId="logs"
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="relative w-[16rem] min-w-[16rem]">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9 font-mono text-sm"
                placeholder="Enter job id"
                title={jobIdInput}
                value={jobIdInput}
                onChange={(event) => setJobIdInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitJobId();
                  }
                }}
              />
            </div>
            <VirtualClusterSelect />
          </div>
        }
      />

      {!selectedJobId ? <LogsEmptyState /> : null}

      {selectedJobId && describedJob.isLoading ? (
        <p className="shrink-0 text-sm text-muted-foreground">Loading job log configuration...</p>
      ) : null}

      {describedJob.error ? (
        <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage(describedJob.error)}
        </p>
      ) : null}

      {selectedJobId && !describedJob.isLoading && !describedJob.error && !hasDestinations ? (
        <p className="shrink-0 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No CloudWatch or S3 monitoring configuration was found for this job.
        </p>
      ) : null}

      {showViewer && s3Destination && (visitedSources.has("s3") || resolvedActiveSource === "s3") ? (
        <S3LogsSource
          hidden={resolvedActiveSource !== "s3"}
          isActive={resolvedActiveSource === "s3"}
          destination={s3Destination}
          selectedJobId={selectedJobId!}
          accountId={accountId}
          selectedKey={s3SelectedKey}
          onSelectedKeyChange={setS3SelectedKey}
          activeSource={resolvedActiveSource}
          onSourceChange={(source) => startTabTransition(() => setActiveSource(source))}
          sourceAvailability={sourceAvailability}
        />
      ) : null}

      {showViewer && cloudWatchDestination && (visitedSources.has("cloudwatch") || resolvedActiveSource === "cloudwatch") ? (
        <CloudWatchLogsSource
          hidden={resolvedActiveSource !== "cloudwatch"}
          isActive={resolvedActiveSource === "cloudwatch"}
          destination={cloudWatchDestination}
          selectedJobId={selectedJobId!}
          accountId={accountId}
          selectedStream={cloudWatchSelectedStream}
          onSelectedStreamChange={setCloudWatchSelectedStream}
          activeSource={resolvedActiveSource}
          onSourceChange={(source) => startTabTransition(() => setActiveSource(source))}
          sourceAvailability={sourceAvailability}
        />
      ) : null}
    </div>
  );
}

function S3LogsSource({
  hidden,
  isActive,
  destination,
  selectedJobId,
  accountId,
  selectedKey,
  onSelectedKeyChange,
  activeSource,
  onSourceChange,
  sourceAvailability
}: {
  hidden: boolean;
  isActive: boolean;
  destination: S3LogDestination;
  selectedJobId: string;
  accountId?: string;
  selectedKey?: string;
  onSelectedKeyChange: (key: string | undefined) => void;
  activeSource: "s3" | "cloudwatch";
  onSourceChange: (source: "s3" | "cloudwatch") => void;
  sourceAvailability: { s3: boolean; cloudwatch: boolean };
}) {
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

  useEffect(() => {
    if (!selectedKey || !objects.length) return;
    if (!objects.some((object) => object.s3Key === selectedKey)) {
      onSelectedKeyChange(undefined);
    }
  }, [objects, onSelectedKeyChange, selectedKey]);

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

  if (hidden) return null;

  return (
    <LogWorkspace
      activeSource={activeSource}
      onSourceChange={onSourceChange}
      sourceAvailability={sourceAvailability}
      destination={destination}
      tree={s3Tree}
      selectedId={resolvedSelectedKey}
      selectedItem={selectedS3Item}
      logText={s3LogObject.data?.content ?? ""}
      isLoading={s3LogObjects.isLoading || s3LogObject.isLoading}
      loadingMessage="Loading S3 archive logs..."
      errorMessage={
        s3LogObjects.error || s3LogObject.error ? errorMessage(s3LogObjects.error ?? s3LogObject.error) : undefined
      }
      onSelect={(item) => onSelectedKeyChange((item as JobLogObject).s3Key)}
      onDownload={() => void downloadSelectedLog()}
    />
  );
}

function CloudWatchLogsSource({
  hidden,
  isActive,
  destination,
  selectedJobId,
  accountId,
  selectedStream,
  onSelectedStreamChange,
  activeSource,
  onSourceChange,
  sourceAvailability
}: {
  hidden: boolean;
  isActive: boolean;
  destination: CloudWatchLogDestination;
  selectedJobId: string;
  accountId?: string;
  selectedStream?: string;
  onSelectedStreamChange: (stream: string | undefined) => void;
  activeSource: "s3" | "cloudwatch";
  onSourceChange: (source: "s3" | "cloudwatch") => void;
  sourceAvailability: { s3: boolean; cloudwatch: boolean };
}) {
  const logStreams = useJobLogStreams(
    isActive
      ? {
          jobId: selectedJobId,
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
          jobId: selectedJobId,
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

  useEffect(() => {
    if (!selectedStream || !streams.length) return;
    if (!streams.some((stream) => stream.cloudWatchStreamName === selectedStream)) {
      onSelectedStreamChange(undefined);
    }
  }, [onSelectedStreamChange, selectedStream, streams]);

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

  if (hidden) return null;

  return (
    <LogWorkspace
      activeSource={activeSource}
      onSourceChange={onSourceChange}
      sourceAvailability={sourceAvailability}
      destination={destination}
      tree={cloudWatchTree}
      selectedId={resolvedSelectedStream}
      selectedItem={selectedCloudWatchItem}
      logText={cloudWatchLogText}
      isLoading={logStreams.isLoading || logs.isLoading}
      loadingMessage="Loading CloudWatch logs..."
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
