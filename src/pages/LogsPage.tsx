import { Archive, Cloud, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDescribeJobRun } from "@/hooks/useEmr";
import { useJobLogs, useJobLogStreams, useS3JobLogObject, useS3JobLogObjects } from "@/hooks/useLogs";
import { cn } from "@/lib/utils";
import { buildEmrLogTree } from "@/services/emrLogTree";
import { defaultCloudWatchDestination, resolveJobLogDestinations } from "@/services/jobLogDestinations";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError, JobLogObject, JobLogStream, JobLogTreeSection } from "@/types/domain";

export function LogsPage() {
  const selectedJobId = useSessionStore((state) => state.selectedJobId);
  const selectedJobVirtualClusterId = useSessionStore((state) => state.selectedJobVirtualClusterId);
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
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
  const resolvedActiveSource = activeSource ?? (cloudWatchDestination ? "cloudwatch" : s3Destination ? "s3" : "cloudwatch");

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
  const downloadLogs = () => {
    if (!logText) return;
    const url = URL.createObjectURL(new Blob([logText], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = sanitizeFileName(`${selectedJobId ?? "job"}-${selectedLabel ?? resolvedActiveSource}.log`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
          {!selectedJobId ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Select a job from Job History to view logs.
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
          <div className="flex justify-end">
            <Button variant="outline" disabled={!logText} onClick={downloadLogs}>
              <Download data-icon="inline-start" />
              Download Current Log
            </Button>
          </div>
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
                onSelect={(item) => setSelectedS3Key((item as JobLogObject).s3Key)}
                selectedLabel={selectedLabel}
                path={selectedPath}
                logText={logText}
              />
            </TabsContent>
          </Tabs>
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
  selectedLabel,
  path,
  logText
}: {
  tree: JobLogTreeSection[];
  selectedId?: string;
  onSelect: (item: JobLogStream | JobLogObject) => void;
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
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</div>
              {section.groups.map((group) => (
                <div key={group.label} className="mb-2">
                  <div className="break-all px-2 py-1 text-xs text-muted-foreground">{group.label}</div>
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
