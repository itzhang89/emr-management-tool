import { Archive, Cloud, Copy, Download, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJobLogs, useJobLogStreams, useS3JobLogObject, useS3JobLogObjects } from "@/hooks/useLogs";
import { cn } from "@/lib/utils";
import { buildEmrLogTree } from "@/services/emrLogTree";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError, JobLogObject, JobLogStream, JobLogTreeSection } from "@/types/domain";

export function LogsPage() {
  const selectedJobId = useSessionStore((state) => state.selectedJobId);
  const selectedJobLogGroupName = useSessionStore((state) => state.selectedJobLogGroupName);
  const selectedJobLogStreamNamePrefix = useSessionStore((state) => state.selectedJobLogStreamNamePrefix);
  const selectedS3Bucket = useSessionStore((state) => state.selectedS3Bucket);
  const selectedS3Prefix = useSessionStore((state) => state.selectedS3Prefix);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [search, setSearch] = useState("");
  const [logGroupName, setLogGroupName] = useState(selectedJobLogGroupName ?? "");
  const [streamNamePrefix, setStreamNamePrefix] = useState(selectedJobLogStreamNamePrefix ?? "");
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [activeSource, setActiveSource] = useState<"cloudwatch" | "s3">(selectedS3Bucket ? "s3" : "cloudwatch");
  const [selectedCloudWatchStream, setSelectedCloudWatchStream] = useState<string>();
  const [selectedS3Key, setSelectedS3Key] = useState<string>();

  useEffect(() => {
    setLogGroupName(selectedJobLogGroupName ?? "");
    setStreamNamePrefix(selectedJobLogStreamNamePrefix ?? "");
    setNextToken(undefined);
    setSelectedCloudWatchStream(undefined);
  }, [selectedJobId, selectedJobLogGroupName, selectedJobLogStreamNamePrefix]);
  useEffect(() => {
    if (selectedS3Bucket) {
      setActiveSource("s3");
      setSelectedS3Key(undefined);
    }
  }, [selectedS3Bucket, selectedS3Prefix]);
  const logStreams = useJobLogStreams(
    selectedJobId && logGroupName && streamNamePrefix
      ? {
          jobId: selectedJobId,
          logGroupName,
          streamNamePrefix
        }
      : undefined,
    autoRefresh
  );
  const s3LogObjects = useS3JobLogObjects(
    selectedS3Bucket && selectedS3Prefix
      ? {
          bucket: selectedS3Bucket,
          prefix: selectedS3Prefix
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
    if (!selectedCloudWatchStream && logStreams.data?.streams[0]) {
      setSelectedCloudWatchStream(logStreams.data.streams[0].cloudWatchStreamName);
    }
  }, [logStreams.data?.streams, selectedCloudWatchStream]);
  useEffect(() => {
    if (!selectedS3Key && s3LogObjects.data?.objects[0]) {
      setSelectedS3Key(s3LogObjects.data.objects[0].s3Key);
    }
  }, [s3LogObjects.data?.objects, selectedS3Key]);
  const logs = useJobLogs(
    selectedJobId && activeSource === "cloudwatch" && selectedCloudWatchStream
      ? {
          jobId: selectedJobId,
          nextForwardToken: nextToken,
          logGroupName: logGroupName || undefined,
          streamNamePrefix: streamNamePrefix || undefined,
          logStreamName: selectedCloudWatchStream,
          filterPattern: search || undefined
        }
      : undefined,
    autoRefresh
  );
  const s3LogObject = useS3JobLogObject(activeSource === "s3" ? selectedS3Bucket : undefined, selectedS3Key);
  const logLines = useMemo(
    () => {
      const sourceLines =
        activeSource === "cloudwatch"
          ? (logs.data?.entries ?? []).map((entry) => `${entry.timestamp} ${entry.level.toUpperCase()} ${entry.message}`)
          : (s3LogObject.data?.content ?? "").split("\n");
      return sourceLines.filter((line) => line.toLowerCase().includes(search.toLowerCase()));
    },
    [activeSource, logs.data?.entries, s3LogObject.data?.content, search]
  );

  const logText = logLines.join("\n");
  const copyLogs = async () => {
    await navigator.clipboard?.writeText(logText);
    toast.success("Logs copied.");
  };
  const downloadLogs = () => {
    const url = URL.createObjectURL(new Blob([logText], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedJobId}-${activeSource}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="text-sm text-muted-foreground">Browse driver, executor, and CloudWatch log streams.</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          Auto Refresh
          <Switch aria-label="Auto refresh logs" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
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
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search log text" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                if (activeSource === "cloudwatch") {
                  void logStreams.refetch();
                  void logs.refetch();
                } else {
                  void s3LogObjects.refetch();
                  void s3LogObject.refetch();
                }
              }}
            >
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
            <Button
              variant="outline"
              disabled={activeSource !== "cloudwatch" || !logs.data?.nextForwardToken}
              onClick={() => setNextToken(logs.data?.nextForwardToken)}
            >
              Next
            </Button>
            <Button variant="outline" onClick={copyLogs}>
              <Copy data-icon="inline-start" />
              Copy
            </Button>
            <Button variant="outline" onClick={downloadLogs}>
              <Download data-icon="inline-start" />
              Download
            </Button>
          </div>
          <Tabs
            value={activeSource}
            onValueChange={(value) => {
              setNextToken(undefined);
              setActiveSource(value as "cloudwatch" | "s3");
            }}
          >
            <TabsList>
              <TabsTrigger value="cloudwatch">
                <Cloud data-icon="inline-start" />
                CloudWatch Live
              </TabsTrigger>
              <TabsTrigger value="s3" disabled={!selectedS3Bucket || !selectedS3Prefix}>
                <Archive data-icon="inline-start" />
                S3 Archive
              </TabsTrigger>
            </TabsList>
            <TabsContent value="cloudwatch" className="mt-4">
              <div className="mb-4 grid grid-cols-2 gap-2">
                <Input
                  placeholder={selectedJobId ? `/aws/emr-containers/jobs/${selectedJobId}` : "Manual CloudWatch log group"}
                  value={logGroupName}
                  onChange={(event) => {
                    setNextToken(undefined);
                    setSelectedCloudWatchStream(undefined);
                    setLogGroupName(event.target.value);
                  }}
                />
                <Input
                  placeholder="Job-level stream prefix"
                  value={streamNamePrefix}
                  onChange={(event) => {
                    setNextToken(undefined);
                    setSelectedCloudWatchStream(undefined);
                    setStreamNamePrefix(event.target.value);
                  }}
                />
              </div>
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
                  setNextToken(undefined);
                  setSelectedCloudWatchStream((item as JobLogStream).cloudWatchStreamName);
                }}
                selectedLabel={selectedCloudWatchItem?.label}
                path={selectedCloudWatchItem?.cloudWatchStreamName}
                logText={logText}
              />
            </TabsContent>
            <TabsContent value="s3" className="mt-4">
              <div className="mb-4 rounded-md border bg-secondary/40 p-3 text-sm">
                <div className="font-medium">S3 archive prefix</div>
                <div className="break-all text-muted-foreground">s3://{selectedS3Bucket ?? "-"}/{selectedS3Prefix ?? ""}</div>
              </div>
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
                selectedLabel={selectedS3Item?.label}
                path={selectedS3Item ? `s3://${selectedS3Bucket}/${selectedS3Item.s3Key}` : undefined}
                logText={logText}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
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
            {logText || "No log lines match the current filters."}
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

function errorMessage(error: unknown) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "Logs require the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? "Failed to load logs.";
}
