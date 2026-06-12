import { Archive, Cloud, Download } from "lucide-react";
import { type FormEvent, type MouseEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDescribeJobRun } from "@/hooks/useEmr";
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
import { s3Service } from "@/services/s3Service";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError, JobLogObject, JobLogStream, JobLogTreeSection } from "@/types/domain";

type DownloadMenuState = {
  x: number;
  y: number;
  label: string;
  items: Array<JobLogStream | JobLogObject>;
};

export function LogsPage() {
  const selectedJobId = useSessionStore((state) => state.selectedJobId);
  const selectedJobVirtualClusterId = useSessionStore((state) => state.selectedJobVirtualClusterId);
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const setSelectedJobForLogs = useSessionStore((state) => state.setSelectedJobForLogs);
  const [jobIdInput, setJobIdInput] = useState(selectedJobId ?? "");
  const describedJob = useDescribeJobRun(selectedJobId, selectedJobVirtualClusterId ?? selectedVirtualClusterId);
  const destinations = useMemo(() => {
    if (!describedJob.data) return {};
    const resolved = resolveJobLogDestinations(describedJob.data);
    return resolved.cloudWatch || resolved.s3 ? resolved : { cloudWatch: defaultCloudWatchDestination(describedJob.data) };
  }, [describedJob.data]);
  const cloudWatchDestination = destinations.cloudWatch;
  const s3Destination = destinations.s3;
  const [activeSource, setActiveSource] = useState<"cloudwatch" | "s3" | undefined>();
  const [selectedCloudWatchStream, setSelectedCloudWatchStream] = useState<string>();
  const [selectedS3Key, setSelectedS3Key] = useState<string>();
  const [downloadMenu, setDownloadMenu] = useState<DownloadMenuState>();
  const resolvedActiveSource = activeSource ?? (cloudWatchDestination ? "cloudwatch" : s3Destination ? "s3" : "cloudwatch");

  useEffect(() => {
    setJobIdInput(selectedJobId ?? "");
  }, [selectedJobId]);
  useEffect(() => {
    setActiveSource(undefined);
    setSelectedCloudWatchStream(undefined);
    setSelectedS3Key(undefined);
  }, [selectedJobId]);
  const logStreams = useJobLogStreams(
    selectedJobId && cloudWatchDestination
      ? {
          jobId: selectedJobId,
          logGroupName: cloudWatchDestination.logGroupName,
          streamNamePrefix: cloudWatchDestination.streamNamePrefix ?? ""
        }
      : undefined,
    false
  );
  const s3LogObjects = useS3JobLogObjects(
    s3Destination
      ? {
          bucket: s3Destination.bucket,
          prefix: s3Destination.prefix
        }
      : undefined
  );
  const cloudWatchTree = useMemo(() => buildEmrLogTree(logStreams.data?.streams ?? []), [logStreams.data?.streams]);
  const s3Tree = useMemo(() => buildEmrLogTree(s3LogObjects.data?.objects ?? []), [s3LogObjects.data?.objects]);
  const selectedCloudWatchItem = useMemo(
    () => logStreams.data?.streams.find((stream) => stream.cloudWatchStreamName === selectedCloudWatchStream),
    [logStreams.data?.streams, selectedCloudWatchStream]
  );
  const selectedS3Item = useMemo(
    () => s3LogObjects.data?.objects.find((object) => object.s3Key === selectedS3Key),
    [s3LogObjects.data?.objects, selectedS3Key]
  );
  useEffect(() => {
    if (!selectedS3Key && s3LogObjects.data?.objects[0]) {
      setSelectedS3Key(s3LogObjects.data.objects[0].s3Key);
    }
  }, [s3LogObjects.data?.objects, selectedS3Key]);
  const logs = useJobLogs(
    selectedJobId && resolvedActiveSource === "cloudwatch" && selectedCloudWatchStream && cloudWatchDestination
      ? {
          jobId: selectedJobId,
          logGroupName: cloudWatchDestination.logGroupName,
          streamNamePrefix: cloudWatchDestination.streamNamePrefix,
          logStreamName: selectedCloudWatchStream
        }
      : undefined,
    false
  );
  const s3LogObject = useS3JobLogObject(resolvedActiveSource === "s3" ? s3Destination?.bucket : undefined, selectedS3Key);
  const logText =
    resolvedActiveSource === "cloudwatch"
      ? (logs.data?.entries ?? []).map((entry) => `${entry.timestamp} ${entry.level.toUpperCase()} ${entry.message}`).join("\n")
      : s3LogObject.data?.content ?? "";
  const selectedPath =
    resolvedActiveSource === "cloudwatch"
      ? selectedCloudWatchItem?.cloudWatchStreamName
      : selectedS3Item && s3Destination
        ? `s3://${s3Destination.bucket}/${selectedS3Item.s3Key}`
        : undefined;
  const selectedLabel = resolvedActiveSource === "cloudwatch" ? selectedCloudWatchItem?.label : selectedS3Item?.label;
  const manualVirtualClusterId = selectedVirtualClusterId ?? selectedJobVirtualClusterId;
  const submitJobId = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedJobId = jobIdInput.trim();
    if (!trimmedJobId) return;
    setSelectedJobForLogs(trimmedJobId, manualVirtualClusterId);
  };
  const openDownloadMenu = (event: MouseEvent, items: Array<JobLogStream | JobLogObject>, label: string) => {
    event.preventDefault();
    if (items.length === 0) return;
    setDownloadMenu({ x: event.clientX, y: event.clientY, items, label });
  };
  const downloadTargetLogs = async (target: DownloadMenuState) => {
    if (!selectedJobId) return;

    try {
      const chunks = await Promise.all(target.items.map((item) => getDownloadChunk(item, selectedJobId, cloudWatchDestination, s3Destination)));
      downloadText(`${selectedJobId}-${target.label}.log`, chunks.join("\n\n"));
      setDownloadMenu(undefined);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="text-sm text-muted-foreground">Browse driver, executor, and CloudWatch log streams.</p>
        </div>
      </div>
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
              <TabsTrigger value="cloudwatch" disabled={!cloudWatchDestination}>
                <Cloud data-icon="inline-start" />
                CloudWatch Live
              </TabsTrigger>
              <TabsTrigger value="s3" disabled={!s3Destination}>
                <Archive data-icon="inline-start" />
                S3 Archive
              </TabsTrigger>
            </TabsList>
            <TabsContent value="cloudwatch" className="mt-4">
              <LogDestinationSummary
                items={[
                  ["Log group", cloudWatchDestination?.logGroupName],
                  ["Stream prefix", cloudWatchDestination?.streamNamePrefix]
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
                onContextDownload={openDownloadMenu}
                onSelect={(item) => {
                  setSelectedCloudWatchStream((item as JobLogStream).cloudWatchStreamName);
                }}
                selectedLabel={selectedLabel}
                path={selectedPath}
                logText={logText}
              />
            </TabsContent>
            <TabsContent value="s3" className="mt-4">
              <LogDestinationSummary items={[["S3 archive prefix", s3Destination ? `s3://${s3Destination.bucket}/${s3Destination.prefix}` : undefined]]} />
              {s3LogObjects.isLoading || s3LogObject.isLoading ? <p className="text-sm text-muted-foreground">Loading S3 archive logs...</p> : null}
              {s3LogObjects.error || s3LogObject.error ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {errorMessage(s3LogObjects.error ?? s3LogObject.error)}
                </p>
              ) : null}
              <LogViewerLayout
                tree={s3Tree}
                selectedId={selectedS3Key}
                onContextDownload={openDownloadMenu}
                onSelect={(item) => setSelectedS3Key((item as JobLogObject).s3Key)}
                selectedLabel={selectedLabel}
                path={selectedPath}
                logText={logText}
              />
            </TabsContent>
          </Tabs>
          {downloadMenu ? (
            <div
              role="menu"
              className="fixed z-50 min-w-44 rounded-md border bg-background p-1 shadow-lg"
              style={{ left: downloadMenu.x, top: downloadMenu.y }}
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => void downloadTargetLogs(downloadMenu)}
              >
                <Download data-icon="inline-start" />
                Download logs
              </button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
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

function LogViewerLayout({
  tree,
  selectedId,
  onSelect,
  onContextDownload,
  selectedLabel,
  path,
  logText
}: {
  tree: JobLogTreeSection[];
  selectedId?: string;
  onSelect: (item: JobLogStream | JobLogObject) => void;
  onContextDownload: (event: MouseEvent, items: Array<JobLogStream | JobLogObject>, label: string) => void;
  selectedLabel?: string;
  path?: string;
  logText: string;
}) {
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
              <div
                className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                onContextMenu={(event) =>
                  onContextDownload(
                    event,
                    section.groups.flatMap((group) => group.items),
                    section.label
                  )
                }
              >
                {section.label}
              </div>
              {section.groups.map((group) => (
                <div key={group.label} className="mb-2">
                  <div
                    className="break-all px-2 py-1 text-xs text-muted-foreground"
                    onContextMenu={(event) => onContextDownload(event, group.items, group.label)}
                  >
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
                      onContextMenu={(event) => openItemDownloadMenu(event, item, onContextDownload)}
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
          <div className="font-medium">{selectedLabel ?? "Select a log"}</div>
          <div className="break-all text-xs text-muted-foreground">{path ?? "Choose a stdout or stderr entry from the log tree."}</div>
        </div>
        <ScrollArea className="h-[560px] bg-slate-950 p-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-100">
            {logText || "Select a log to view its content."}
          </pre>
        </ScrollArea>
      </div>
    </div>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function openItemDownloadMenu(
  event: MouseEvent,
  item: JobLogStream | JobLogObject,
  onContextDownload: (event: MouseEvent, items: Array<JobLogStream | JobLogObject>, label: string) => void
) {
  event.stopPropagation();
  onContextDownload(event, [item], item.label);
}

async function getDownloadChunk(
  item: JobLogStream | JobLogObject,
  jobId: string,
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
  const response = await s3Service.getJobLogObject(s3Destination.bucket, item.s3Key);
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
    lines.push(...response.entries.map((entry) => `${entry.timestamp} ${entry.level.toUpperCase()} ${entry.message}`));
    nextForwardToken = response.nextForwardToken && response.nextForwardToken !== requestToken ? response.nextForwardToken : undefined;
  } while (nextForwardToken);

  return lines;
}

function downloadText(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = sanitizeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "job.log";
}

function errorMessage(error: unknown) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "Logs require the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? "Failed to load logs.";
}
