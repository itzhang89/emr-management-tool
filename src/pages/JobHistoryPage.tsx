import { Copy, Download, FileText, Play, RefreshCw, Search, Skull, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VirtualClusterSelect, useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { useCancelJobRun, useDescribeJobRun, useJobRuns, useStartJobRun, useVirtualClusters } from "@/hooks/useEmr";
import { cn } from "@/lib/utils";
import { emrService } from "@/services/emrService";
import { formatAppError, formatJobHistoryError } from "@/services/appErrorMessage";
import { saveTextFile } from "@/services/fileDownload";
import { useSessionStore } from "@/stores/sessionStore";
import type { JobRunDescribeDetails, JobRunSummary } from "@/types/domain";

const pageSize = 10;
const autoRefreshStorageKey = "emr-eks:job-history-auto-refresh";
const jobHistoryRefreshIntervalMs = 5_000;
const jobHistoryRefreshIntervalSeconds = jobHistoryRefreshIntervalMs / 1_000;

export function JobHistoryPage({ onOpenLogs }: { onOpenLogs?: () => void; onOpenS3?: () => void }) {
  const selectedJobId = useSessionStore((state) => state.selectedJobId);
  const setSelectedJobId = useSessionStore((state) => state.setSelectedJobId);
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const [autoRefresh, setAutoRefresh] = useState(() => readAutoRefreshPreference());
  const [refreshCountdown, setRefreshCountdown] = useState(jobHistoryRefreshIntervalSeconds);
  const cancelJob = useCancelJobRun();
  const startJob = useStartJobRun();
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [remoteJob, setRemoteJob] = useState<JobRunSummary>();
  const [remoteLookupPending, setRemoteLookupPending] = useState(false);
  const [remoteLookupError, setRemoteLookupError] = useState<string>();
  const submittedKeyword = submittedSearch.trim() || undefined;
  const clusters = useVirtualClusters();
  const jobs = useJobRuns(effectiveVirtualClusterId, autoRefresh, submittedKeyword);
  const isSyncingJobs =
    jobs.isLoading || (clusters.isLoading && effectiveVirtualClusterId === undefined);
  const allJobs = useMemo(() => {
    const localJobs = jobs.data ?? [];
    if (!remoteJob || remoteJob.virtualClusterId !== effectiveVirtualClusterId) return localJobs;
    if (!jobMatchesKeyword(remoteJob, submittedKeyword)) return localJobs;
    if (localJobs.some((job) => job.id === remoteJob.id)) return localJobs;
    return [remoteJob, ...localJobs];
  }, [effectiveVirtualClusterId, jobs.data, remoteJob, submittedKeyword]);
  const filteredJobs = allJobs;
  const pageCount = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const visibleJobs = filteredJobs.slice((page - 1) * pageSize, page * pageSize);
  const selectedJob = filteredJobs.find((job) => job.id === selectedJobId);
  const searchedJobId = submittedSearch.trim();
  const exactLocalMatch = searchedJobId ? allJobs.find((job) => job.id === searchedJobId) : undefined;
  const canFindInAws = Boolean(searchedJobId && filteredJobs.length === 0 && isLikelyEmrJobRunId(searchedJobId));

  const findJobInAws = async () => {
    if (!searchedJobId) return;
    if (exactLocalMatch) {
      setSelectedJobId(exactLocalMatch.id);
      return;
    }
    if (filteredJobs.length > 0) return;
    if (!effectiveVirtualClusterId) {
      toast.error("Select a virtual cluster before looking up a job in AWS.");
      return;
    }

    setRemoteLookupPending(true);
    setRemoteLookupError(undefined);
    try {
      const job = await emrService.describeJobRun(searchedJobId, effectiveVirtualClusterId);
      setRemoteJob(job);
      setSearchInput(job.id);
      setSubmittedSearch(job.id);
      setSelectedJobId(job.id);
      setPage(1);
      void jobs.refetch?.();
      toast.success(`Found ${job.name}`);
    } catch (error) {
      const message = remoteLookupErrorMessage(error, searchedJobId, effectiveVirtualClusterId);
      setRemoteLookupError(message);
      toast.error(message);
    } finally {
      setRemoteLookupPending(false);
    }
  };

  const submitLocalSearch = () => {
    const trimmedSearch = searchInput.trim();
    setRemoteLookupError(undefined);
    setPage(1);
    if (trimmedSearch === submittedSearch.trim() && canFindInAws) {
      void findJobInAws();
      return;
    }
    setSubmittedSearch(trimmedSearch);
  };

  useEffect(() => {
    writeAutoRefreshPreference(autoRefresh);
  }, [autoRefresh]);

  useEffect(() => {
    if (!autoRefresh) {
      setRefreshCountdown(jobHistoryRefreshIntervalSeconds);
      return;
    }

    setRefreshCountdown(jobHistoryRefreshIntervalSeconds);
    const timer = window.setInterval(() => {
      setRefreshCountdown((current) => (current <= 1 ? jobHistoryRefreshIntervalSeconds : current - 1));
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    if (autoRefresh) {
      setRefreshCountdown(jobHistoryRefreshIntervalSeconds);
    }
  }, [autoRefresh, jobs.dataUpdatedAt]);

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
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setRemoteLookupError(undefined);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitLocalSearch();
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Switch
                id="job-history-auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label="Auto refresh job history"
              />
              <label htmlFor="job-history-auto-refresh" className="flex items-center gap-1 text-sm text-muted-foreground">
                <RefreshCw className={cn("size-4", autoRefresh && jobs.isFetching ? "animate-spin" : undefined)} />
                Auto refresh
                {autoRefresh ? <span className="tabular-nums text-xs">{refreshCountdown}s</span> : null}
              </label>
            </div>
            <VirtualClusterSelect />
            <span className="text-sm text-muted-foreground">{filteredJobs.length} jobs</span>
          </div>
          {jobs.isLoading && filteredJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading job history...</p>
          ) : null}
          {jobs.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {formatJobHistoryError(jobs.error)}
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
                      <JobLogActions job={job} onOpenLogs={onOpenLogs} />
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
                    <div className="flex flex-col items-center gap-3">
                      <span>{emptyJobsMessage({
                        submittedKeyword,
                        effectiveVirtualClusterId,
                        isSyncingJobs,
                        autoRefresh
                      })}</span>
                      {canFindInAws ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={remoteLookupPending}
                          onClick={() => void findJobInAws()}
                        >
                          <Search data-icon="inline-start" />
                          {remoteLookupPending ? "Finding..." : "Find in AWS"}
                        </Button>
                      ) : null}
                      {remoteLookupError ? <span className="max-w-md text-sm text-destructive">{remoteLookupError}</span> : null}
                    </div>
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

function JobLogActions({ job, onOpenLogs }: { job: JobRunSummary; onOpenLogs?: () => void }) {
  const setSelectedJobForLogs = useSessionStore((state) => state.setSelectedJobForLogs);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        setSelectedJobForLogs(job.id, job.virtualClusterId);
        onOpenLogs?.();
      }}
    >
      <FileText data-icon="inline-start" />
      Logs
    </Button>
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

  const downloadDescription = async () => {
    try {
      const savedPath = await saveTextFile(`${detail.id}-description.json`, JSON.stringify(detail, null, 2));
      if (savedPath) {
        toast.success(`Saved to ${savedPath}`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
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
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => void downloadDescription()}>
            <Download data-icon="inline-start" />
            Download JSON
          </Button>
          <Button variant="outline" size="sm" onClick={copyJobId}>
            <Copy data-icon="inline-start" />
            Copy Job ID
          </Button>
        </div>
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

function formatJson(value?: Record<string, unknown> | Record<string, string> | object) {
  if (!value || Object.keys(value).length === 0) return undefined;
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown) {
  return formatAppError(error, "Job operation failed.");
}

function remoteLookupErrorMessage(error: unknown, jobId: string, virtualClusterId: string) {
  const appError = error as { kind?: string; message?: string; code?: string; service?: string };
  const rawMessage = appError.message ?? "";
  if (
    appError.kind === "aws" &&
    (/service error/i.test(rawMessage) || /not.?found/i.test(rawMessage) || /resource.*not.*found/i.test(rawMessage))
  ) {
    return `Job ${jobId} was not found in AWS EMR for virtual cluster ${virtualClusterId}. Check the Job ID and selected Virtual Cluster.`;
  }
  return errorMessage(error);
}

function isLikelyEmrJobRunId(value: string) {
  const trimmed = value.trim();
  return /^job-[A-Za-z0-9-]+$/.test(trimmed) || /^[a-z0-9]{16,64}$/.test(trimmed);
}

function jobMatchesKeyword(job: JobRunSummary, keyword?: string) {
  const normalized = keyword?.trim().toLowerCase();
  if (!normalized) return true;
  return [job.name, job.id, job.state, JSON.stringify(job)].some((value) => value.toLowerCase().includes(normalized));
}

function emptyJobsMessage({
  submittedKeyword,
  effectiveVirtualClusterId,
  isSyncingJobs,
  autoRefresh
}: {
  submittedKeyword?: string;
  effectiveVirtualClusterId?: string;
  isSyncingJobs: boolean;
  autoRefresh: boolean;
}) {
  if (submittedKeyword) {
    return "No jobs match the current filters.";
  }
  if (isSyncingJobs) {
    return autoRefresh
      ? "Syncing job runs from AWS. Auto refresh is enabled."
      : "Loading job runs from AWS...";
  }
  if (!effectiveVirtualClusterId) {
    return "Select a virtual cluster to sync job runs from AWS.";
  }
  return autoRefresh
    ? "No job runs found yet. Auto refresh will keep checking AWS."
    : "No job runs found for the selected virtual cluster.";
}

function readAutoRefreshPreference() {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(autoRefreshStorageKey);
    if (stored === null) return true;
    return stored === "true";
  } catch {
    return true;
  }
}

function writeAutoRefreshPreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(autoRefreshStorageKey, String(enabled));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}
