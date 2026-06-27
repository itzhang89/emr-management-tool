import { FileText, Play, Search, Skull } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JobAutoRefreshToggle } from "@/components/emr/JobAutoRefreshToggle";
import { JobDetailAction } from "@/components/emr/JobDetailAction";
import {
  useCancelJobRun,
  useJobRuns,
  useStartJobRun,
  useSubmissionHistory,
  useVirtualClusters,
  type JobRunsQuery
} from "@/hooks/useEmr";
import { useJobHistoryAutoRefresh } from "@/hooks/useJobHistoryAutoRefresh";
import { isLikelyEmrJobRunId } from "@/services/emrJobId";
import { emrService } from "@/services/emrService";
import { formatAppError, formatJobHistoryError } from "@/services/appErrorMessage";
import { JOB_HISTORY_PAGE_SIZE, SUBMISSION_HISTORY_LIMIT, JOB_HISTORY_REFRESH_INTERVAL_SECONDS } from "@/services/jobHistoryConstants";
import { formatJobRunDuration } from "@/services/jobRunDisplay";
import { useSessionStore } from "@/stores/sessionStore";
import type { JobRunSummary } from "@/types/domain";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function JobRunsPanel({
  virtualClusterId,
  keyword,
  onOpenLogs,
  title,
  className,
  autoRefresh: autoRefreshProp,
  onAutoRefreshChange,
  showAutoRefreshControl = false,
  showFindInAws = false,
  searchedJobId,
  findInAwsSignal,
  submittedOnly = false,
  clusterJobsQuery
}: {
  virtualClusterId?: string;
  keyword?: string;
  onOpenLogs?: () => void;
  title?: string;
  className?: string;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (enabled: boolean) => void;
  showAutoRefreshControl?: boolean;
  showFindInAws?: boolean;
  searchedJobId?: string;
  findInAwsSignal?: number;
  submittedOnly?: boolean;
  clusterJobsQuery?: JobRunsQuery;
}) {
  const [detailJobId, setDetailJobId] = useState<string>();
  const [page, setPage] = useState(1);
  const [remoteJob, setRemoteJob] = useState<JobRunSummary>();
  const [remoteLookupPending, setRemoteLookupPending] = useState(false);
  const [remoteLookupError, setRemoteLookupError] = useState<string>();
  const cancelJob = useCancelJobRun();
  const startJob = useStartJobRun();
  const clusters = useVirtualClusters();

  const panelAutoRefresh = useJobHistoryAutoRefresh({
    enabled: showAutoRefreshControl,
    persistPreference: showAutoRefreshControl
  });
  const autoRefresh = autoRefreshProp ?? panelAutoRefresh.autoRefresh;
  const setAutoRefresh = onAutoRefreshChange ?? panelAutoRefresh.setAutoRefresh;
  const submittedKeyword = keyword?.trim() || undefined;
  const useExternalClusterQuery = Boolean(clusterJobsQuery && !submittedOnly);
  const internalClusterJobs = useJobRuns(
    virtualClusterId,
    autoRefresh,
    submittedKeyword,
    !submittedOnly && !useExternalClusterQuery
  );
  const submissionJobs = useSubmissionHistory(virtualClusterId, autoRefresh, submittedOnly);
  const jobs = submittedOnly ? submissionJobs : (clusterJobsQuery ?? internalClusterJobs);

  useEffect(() => {
    if (!showAutoRefreshControl || !autoRefresh) return;
    panelAutoRefresh.setRefreshCountdown(JOB_HISTORY_REFRESH_INTERVAL_SECONDS);
  }, [autoRefresh, jobs.dataUpdatedAt, panelAutoRefresh.setRefreshCountdown, showAutoRefreshControl]);

  const isSyncingJobs = submittedOnly
    ? jobs.isLoading
    : jobs.isLoading || (clusters.isLoading && virtualClusterId === undefined);

  const allJobs = useMemo(() => {
    const localJobs = jobs.data ?? [];
    if (submittedOnly || !remoteJob || remoteJob.virtualClusterId !== virtualClusterId) return localJobs;
    if (!jobMatchesKeyword(remoteJob, submittedKeyword)) return localJobs;
    if (localJobs.some((job) => job.id === remoteJob.id)) return localJobs;
    return [remoteJob, ...localJobs];
  }, [jobs.data, remoteJob, submittedKeyword, submittedOnly, virtualClusterId]);

  const pageCount = Math.max(1, Math.ceil(allJobs.length / JOB_HISTORY_PAGE_SIZE));
  const visibleJobs = submittedOnly
    ? allJobs
    : allJobs.slice((page - 1) * JOB_HISTORY_PAGE_SIZE, page * JOB_HISTORY_PAGE_SIZE);
  const canFindInAws = Boolean(
    !submittedOnly && showFindInAws && searchedJobId && allJobs.length === 0 && isLikelyEmrJobRunId(searchedJobId)
  );

  const findJobInAws = async () => {
    if (!searchedJobId || allJobs.length > 0 || !virtualClusterId) {
      if (!virtualClusterId) {
        toast.error("Select a virtual cluster before looking up a job in AWS.");
      }
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
    if (!findInAwsSignal || !canFindInAws) return;
    void findJobInAws();
  }, [findInAwsSignal, canFindInAws, searchedJobId, virtualClusterId]);

  useEffect(() => {
    setPage(1);
  }, [keyword, virtualClusterId, submittedOnly]);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {title || showAutoRefreshControl ? (
        <div className="flex shrink-0 items-center justify-between gap-2">
          {title ? (
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              {submittedOnly ? (
                <p className="text-xs text-muted-foreground">
                  Latest {SUBMISSION_HISTORY_LIMIT} jobs submitted from this app for the selected virtual cluster.
                </p>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">{allJobs.length} jobs</span>
          )}
          {showAutoRefreshControl ? (
            <JobAutoRefreshToggle
              id="submit-job-auto-refresh"
              autoRefresh={autoRefresh}
              onAutoRefreshChange={setAutoRefresh}
              isFetching={jobs.isFetching}
              refreshCountdown={panelAutoRefresh.refreshCountdown}
            />
          ) : null}
        </div>
      ) : null}

      {jobs.isLoading && allJobs.length === 0 ? (
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
              {allJobs.length === 0 ? (
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
        {!submittedOnly ? (
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
