import { FileText, Play, RefreshCw, Search, Skull } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { JobDetailAction } from "@/components/emr/JobDetailAction";
import { useCancelJobRun, useJobRuns, useStartJobRun, useSubmissionHistory, useVirtualClusters } from "@/hooks/useEmr";
import { cn } from "@/lib/utils";
import { emrService } from "@/services/emrService";
import { formatAppError, formatJobHistoryError } from "@/services/appErrorMessage";
import { formatJobRunDuration } from "@/services/jobRunDisplay";
import { useSessionStore } from "@/stores/sessionStore";
import type { JobRunSummary } from "@/types/domain";

const defaultPageSize = 10;
const autoRefreshStorageKey = "emr-eks:job-history-auto-refresh";
const jobHistoryRefreshIntervalMs = 5_000;
const jobHistoryRefreshIntervalSeconds = jobHistoryRefreshIntervalMs / 1_000;

export function JobRunsPanel({
  virtualClusterId,
  keyword,
  onOpenLogs,
  maxItems,
  title,
  className,
  autoRefresh: autoRefreshProp,
  onAutoRefreshChange,
  showAutoRefreshControl = false,
  showFindInAws = false,
  searchedJobId,
  findInAwsSignal,
  submittedOnly = false
}: {
  virtualClusterId?: string;
  keyword?: string;
  onOpenLogs?: () => void;
  maxItems?: number;
  title?: string;
  className?: string;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (enabled: boolean) => void;
  showAutoRefreshControl?: boolean;
  showFindInAws?: boolean;
  searchedJobId?: string;
  findInAwsSignal?: number;
  submittedOnly?: boolean;
}) {
  const [detailJobId, setDetailJobId] = useState<string>();
  const [internalAutoRefresh, setInternalAutoRefresh] = useState(() => readAutoRefreshPreference());
  const [refreshCountdown, setRefreshCountdown] = useState(jobHistoryRefreshIntervalSeconds);
  const [page, setPage] = useState(1);
  const [remoteJob, setRemoteJob] = useState<JobRunSummary>();
  const [remoteLookupPending, setRemoteLookupPending] = useState(false);
  const [remoteLookupError, setRemoteLookupError] = useState<string>();
  const cancelJob = useCancelJobRun();
  const startJob = useStartJobRun();
  const clusters = useVirtualClusters();

  const autoRefresh = autoRefreshProp ?? internalAutoRefresh;
  const setAutoRefresh = onAutoRefreshChange ?? setInternalAutoRefresh;
  const submittedKeyword = keyword?.trim() || undefined;
  const clusterJobs = useJobRuns(virtualClusterId, autoRefresh, submittedKeyword);
  const submissionJobs = useSubmissionHistory(virtualClusterId, autoRefresh);
  const jobs = submittedOnly ? submissionJobs : clusterJobs;
  const isSyncingJobs = submittedOnly
    ? jobs.isLoading
    : jobs.isLoading || (clusters.isLoading && virtualClusterId === undefined);

  const allJobs = useMemo(() => {
    const localJobs = jobs.data ?? [];
    if (!remoteJob || remoteJob.virtualClusterId !== virtualClusterId) return localJobs;
    if (!jobMatchesKeyword(remoteJob, submittedKeyword)) return localJobs;
    if (localJobs.some((job) => job.id === remoteJob.id)) return localJobs;
    return [remoteJob, ...localJobs];
  }, [jobs.data, remoteJob, submittedKeyword, virtualClusterId]);

  const filteredJobs = maxItems ? allJobs.slice(0, maxItems) : allJobs;
  const pageSize = maxItems ?? defaultPageSize;
  const pageCount = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const visibleJobs = maxItems ? filteredJobs : filteredJobs.slice((page - 1) * pageSize, page * pageSize);
  const canFindInAws = Boolean(
    !submittedOnly && showFindInAws && searchedJobId && filteredJobs.length === 0 && isLikelyEmrJobRunId(searchedJobId)
  );

  const findJobInAws = async () => {
    if (!searchedJobId) return;
    if (filteredJobs.length > 0) return;
    if (!virtualClusterId) {
      toast.error("Select a virtual cluster before looking up a job in AWS.");
      return;
    }

    setRemoteLookupPending(true);
    setRemoteLookupError(undefined);
    try {
      const job = await emrService.describeJobRun(searchedJobId, virtualClusterId);
      setRemoteJob(job);
      setDetailJobId(job.id);
      setPage(1);
      void jobs.refetch?.();
      toast.success(`Found ${job.name}`);
    } catch (error) {
      const message = remoteLookupErrorMessage(error, searchedJobId, virtualClusterId);
      setRemoteLookupError(message);
      toast.error(message);
    } finally {
      setRemoteLookupPending(false);
    }
  };

  useEffect(() => {
    if (!findInAwsSignal) return;
    if (!canFindInAws) return;
    void findJobInAws();
  }, [findInAwsSignal, canFindInAws, searchedJobId, virtualClusterId]);

  useEffect(() => {
    if (onAutoRefreshChange) return;
    writeAutoRefreshPreference(autoRefresh);
  }, [autoRefresh, onAutoRefreshChange]);

  useEffect(() => {
    setPage(1);
  }, [keyword, virtualClusterId, maxItems]);

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
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {title || showAutoRefreshControl ? (
        <div className="flex shrink-0 items-center justify-between gap-2">
          {title ? (
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              {maxItems ? (
                <p className="text-xs text-muted-foreground">
                  Latest {maxItems} jobs submitted from this app for the selected virtual cluster.
                </p>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">{filteredJobs.length} jobs</span>
          )}
          {showAutoRefreshControl ? (
            <div className="flex h-9 shrink-0 items-center gap-2 rounded-md border px-2">
              <Switch
                id={maxItems ? "submit-job-auto-refresh" : "job-history-auto-refresh-inline"}
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label="Auto refresh job history"
              />
              <label
                htmlFor={maxItems ? "submit-job-auto-refresh" : "job-history-auto-refresh-inline"}
                className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"
              >
                <RefreshCw className={cn("size-3.5", autoRefresh && jobs.isFetching ? "animate-spin" : undefined)} />
                Auto refresh
                {autoRefresh ? <span className="tabular-nums">{refreshCountdown}s</span> : null}
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {jobs.isLoading && filteredJobs.length === 0 ? (
        <p className="shrink-0 text-sm text-muted-foreground">
          {submittedOnly ? "Loading recent submissions..." : "Loading job history..."}
        </p>
      ) : null}
      {jobs.error ? (
        <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {formatJobHistoryError(jobs.error)}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
        <div className="min-h-0 flex-1 overflow-auto">
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
                    <Badge
                      variant={job.state === "FAILED" ? "destructive" : job.state === "RUNNING" ? "default" : "secondary"}
                    >
                      {job.state}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{formatJobRunDuration(job)}</TableCell>
                  <TableCell className="w-[360px] min-w-[360px]">
                    <div className="flex justify-start gap-2">
                      <JobDetailAction
                        job={job}
                        open={detailJobId === job.id}
                        onOpenChange={(open) => setDetailJobId(open ? job.id : undefined)}
                      />
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
                  </TableCell>
                </TableRow>
              ))}
              {filteredJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <span>
                        {emptyJobsMessage({
                          submittedKeyword,
                          effectiveVirtualClusterId: virtualClusterId,
                          isSyncingJobs,
                          autoRefresh,
                          submittedOnly
                        })}
                      </span>
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
                      {remoteLookupError ? (
                        <span className="max-w-md text-sm text-destructive">{remoteLookupError}</span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        {!maxItems ? (
          <div className="flex shrink-0 items-center justify-between border-t px-4 py-3">
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
        ) : null}
      </div>
    </div>
  );
}

export function readAutoRefreshPreference() {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(autoRefreshStorageKey);
    if (stored === null) return true;
    return stored === "true";
  } catch {
    return true;
  }
}

export function writeAutoRefreshPreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(autoRefreshStorageKey, String(enabled));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
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
  autoRefresh,
  submittedOnly = false
}: {
  submittedKeyword?: string;
  effectiveVirtualClusterId?: string;
  isSyncingJobs: boolean;
  autoRefresh: boolean;
  submittedOnly?: boolean;
}) {
  if (submittedKeyword) {
    return "No jobs match the current filters.";
  }
  if (isSyncingJobs) {
    return submittedOnly
      ? "Loading recent submissions..."
      : autoRefresh
        ? "Syncing job runs from AWS. Auto refresh is enabled."
        : "Loading job runs from AWS...";
  }
  if (!effectiveVirtualClusterId) {
    return submittedOnly
      ? "Select a virtual cluster to see jobs submitted from this app."
      : "Select a virtual cluster to sync job runs from AWS.";
  }
  if (submittedOnly) {
    return autoRefresh
      ? "No jobs submitted from this app yet. Auto refresh is enabled."
      : "No jobs submitted from this app for the selected virtual cluster.";
  }
  return autoRefresh
    ? "No job runs found yet. Auto refresh will keep checking AWS."
    : "No job runs found for the selected virtual cluster.";
}
