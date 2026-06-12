import { Copy, FileText, Play, Search, Skull, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCancelJobRun, useDescribeJobRun, useJobRuns, useStartJobRun } from "@/hooks/useEmr";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError, JobRunDescribeDetails, JobRunSummary } from "@/types/domain";

const pageSize = 10;

export function JobHistoryPage({ onOpenLogs }: { onOpenLogs?: () => void }) {
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const selectedJobId = useSessionStore((state) => state.selectedJobId);
  const setSelectedJobId = useSessionStore((state) => state.setSelectedJobId);
  const setSelectedJobForLogs = useSessionStore((state) => state.setSelectedJobForLogs);
  const jobs = useJobRuns(selectedVirtualClusterId);
  const cancelJob = useCancelJobRun();
  const startJob = useStartJobRun();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filteredJobs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return jobs.data ?? [];
    return (jobs.data ?? []).filter((job) =>
      [job.name, job.id, job.state].some((value) => value.toLowerCase().includes(keyword))
    );
  }, [jobs.data, search]);
  const pageCount = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const visibleJobs = filteredJobs.slice((page - 1) * pageSize, page * pageSize);
  const selectedJob = filteredJobs.find((job) => job.id === selectedJobId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Job History</h1>
        <p className="text-sm text-muted-foreground">Review submitted jobs, clone configurations, or cancel active runs.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Submitted Jobs</CardTitle>
          <CardDescription>Local history and remote job states share the same view.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-2">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search jobs by name, id, state, or keyword"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <span className="text-sm text-muted-foreground">{filteredJobs.length} jobs</span>
          </div>
          {jobs.isLoading ? <p className="text-sm text-muted-foreground">Loading job history...</p> : null}
          {jobs.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage(jobs.error)}
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Created Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="w-[360px] min-w-[360px] text-left">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.name}</TableCell>
                  <TableCell>
                    <Badge variant={job.state === "FAILED" ? "destructive" : job.state === "RUNNING" ? "default" : "secondary"}>
                      {job.state}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{formatDuration(job)}</TableCell>
                  <TableCell className="relative w-[360px] min-w-[360px]">
                    <div className="flex justify-start gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedJobId(job.id)}>
                        <ZoomIn data-icon="inline-start" />
                        Detail
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedJobForLogs(job.id, defaultLogGroupName(job), defaultLogStreamPrefix(job));
                          onOpenLogs?.();
                        }}
                      >
                        <FileText data-icon="inline-start" />
                        Logs
                      </Button>
                      {job.state === "RUNNING" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancelJob.isPending}
                        onClick={() =>
                          cancelJob.mutate(
                            { id: job.id, virtualClusterId: job.virtualClusterId },
                            {
                              onSuccess: () => toast.success("Kill requested."),
                              onError: (error) => toast.error(errorMessage(error))
                            }
                          )
                        }
                      >
                        <Skull data-icon="inline-start" />
                        Kill
                      </Button>
                      ) : null}
                      {job.state === "FAILED" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={startJob.isPending}
                        onClick={() => {
                          if (!job.sourceRequest) {
                            toast.error("This failed job has no locally saved submit configuration to rerun.");
                            return;
                          }
                          startJob.mutate(job.sourceRequest, {
                            onSuccess: () => toast.success("Rerun submitted."),
                            onError: (error) => toast.error(errorMessage(error))
                          });
                        }}
                      >
                        <Play data-icon="inline-start" />
                        Rerun
                      </Button>
                      ) : null}
                    </div>
                    {selectedJob?.id === job.id ? <JobDetailPopover job={selectedJob} onClose={() => setSelectedJobId(undefined)} /> : null}
                  </TableCell>
                </TableRow>
              ))}
              {filteredJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    No jobs match the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {pageCount}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function JobDetailPopover({ job, onClose }: { job: JobRunSummary; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const describedJob = useDescribeJobRun(job.id, job.virtualClusterId);
  const detail = describedJob.data ?? job;
  const describeDetails = detail.describeDetails;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const copyJobId = async () => {
    await navigator.clipboard?.writeText(job.id);
    toast.success("Job ID copied.");
    onClose();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Job Detail"
      className="absolute right-0 top-10 z-20 max-h-[70vh] w-[420px] overflow-y-auto rounded-lg border bg-background p-4 text-left shadow-lg"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Job Detail</p>
          <p className="break-all text-xs text-muted-foreground">{job.id}</p>
        </div>
        <Button variant="outline" size="sm" onClick={copyJobId}>
          <Copy data-icon="inline-start" />
          Copy Job ID
        </Button>
      </div>
      {describedJob.isLoading ? <p className="text-sm text-muted-foreground">Loading job details...</p> : null}
      {describedJob.error ? (
        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
          {errorMessage(describedJob.error)}
        </p>
      ) : null}
      <div className="grid gap-3 text-sm">
        <Detail label="Name" value={detail.name} />
        <Detail label="State" value={detail.state} />
        <Detail label="Virtual Cluster" value={detail.virtualClusterId} />
        <Detail label="Created" value={formatTimestamp(detail.createdAt)} />
        <Detail label="Started" value={formatTimestamp(detail.startedAt)} />
        <Detail label="Finished" value={formatTimestamp(detail.finishedAt)} />
        <Detail label="Duration" value={formatDuration(detail)} />
        <Detail label="ARN" value={describeDetails?.arn} />
        <Detail label="Release Label" value={describeDetails?.releaseLabel} />
        <Detail label="Execution Role" value={describeDetails?.executionRoleArn} />
        <Detail label="Created By" value={describeDetails?.createdBy} />
        <Detail label="Client Token" value={describeDetails?.clientToken} />
        <Detail label="State Details" value={describeDetails?.stateDetails} />
        <Detail label="Failure Reason" value={describeDetails?.failureReason} />
        <Detail
          label="Retry Attempts"
          value={
            describeDetails?.retryMaxAttempts !== undefined || describeDetails?.retryCurrentAttemptCount !== undefined
              ? `${describeDetails?.retryCurrentAttemptCount ?? "-"} / ${describeDetails?.retryMaxAttempts ?? "-"}`
              : undefined
          }
        />
        <Detail label="Job Driver" value={formatJobDriver(describeDetails)} multiline />
        <Detail label="Tags" value={formatJson(describeDetails?.tags)} multiline />
        <Detail label="Configuration Overrides" value={formatJson(describeDetails?.configurationOverrides)} multiline />
      </div>
    </div>
  );
}

function formatDuration(job: JobRunSummary) {
  const seconds = job.durationSeconds ?? durationFromTimestamps(job);
  if (!seconds || seconds < 0) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

function durationFromTimestamps(job: JobRunSummary) {
  const start = Date.parse(job.startedAt ?? job.createdAt);
  const end = Date.parse(job.finishedAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, Math.round((end - start) / 1000));
}

function defaultLogGroupName(job: JobRunSummary) {
  return `/aws/emr-containers/jobs/${job.id}`;
}

function defaultLogStreamPrefix(job: JobRunSummary) {
  return job.id;
}

function Detail({ label, value, multiline = false }: { label: string; value?: string; multiline?: boolean }) {
  if (!value) return null;

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={multiline ? "whitespace-pre-wrap break-all font-medium" : "break-all font-medium"}>{value}</p>
    </div>
  );
}

function formatTimestamp(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function formatJobDriver(details?: JobRunDescribeDetails) {
  const driver = details?.jobDriver;
  if (!driver) return undefined;

  if (driver.type === "sparkSubmit") {
    const lines = [
      driver.entryPoint ? `Entry Point: ${driver.entryPoint}` : undefined,
      driver.entryPointArguments?.length ? `Arguments: ${driver.entryPointArguments.join(" ")}` : undefined,
      driver.sparkSubmitParameters ? `Spark Submit: ${driver.sparkSubmitParameters}` : undefined
    ].filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : undefined;
  }

  const lines = [
    driver.entryPoint ? `Entry Point: ${driver.entryPoint}` : undefined,
    driver.sparkSqlParameters ? `Spark SQL: ${driver.sparkSqlParameters}` : undefined
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatJson(value?: Record<string, unknown> | Record<string, string>) {
  if (!value || Object.keys(value).length === 0) return undefined;
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "Job history requires the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? "Job operation failed.";
}
