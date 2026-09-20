import { FileText, Play, Search, Skull, Sparkles } from "lucide-react";
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
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useLocale, useT, localeTag, type Translator } from "@/i18n";
import { isLikelyEmrJobRunId } from "@/services/emrJobId";
import { emrService } from "@/services/emrService";
import { formatAppError, formatJobHistoryError } from "@/services/appErrorMessage";
import { JOB_HISTORY_PAGE_SIZE, SUBMISSION_HISTORY_LIMIT } from "@/services/jobHistoryConstants";
import { formatJobRunDuration } from "@/services/jobRunDisplay";
import { describeJobToStartJobPayload, isSparkSubmitDescribe } from "@/services/startJobPayload";
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
  autoRefresh = false,
  onAutoRefreshChange,
  refreshCountdown = 0,
  showAutoRefreshControl = false,
  showFindInAws = false,
  searchedJobId,
  findInAwsSignal,
  submittedOnly = false,
  clusterJobsQuery,
  submissionJobsQuery,
  onSubmissionStarted,
  onOpenSubmit,
  onOpenAiAssistant
}: {
  virtualClusterId?: string;
  keyword?: string;
  /** Carries the job whose Logs button was pressed, so the caller does not have
   *  to re-read the session store to find out which one it was. */
  onOpenLogs?: (job: JobRunSummary) => void;
  title?: string;
  className?: string;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (enabled: boolean) => void;
  refreshCountdown?: number;
  showAutoRefreshControl?: boolean;
  showFindInAws?: boolean;
  searchedJobId?: string;
  findInAwsSignal?: number;
  submittedOnly?: boolean;
  clusterJobsQuery?: JobRunsQuery;
  submissionJobsQuery?: JobRunsQuery;
  onSubmissionStarted?: () => void;
  onOpenSubmit?: () => void;
  /** When provided, FAILED rows gain an "Analyze" action that sends the job to
      the AI assistant for failure analysis. Optional so the panel's other
      hosts (submit page, dashboard) stay unchanged. */
  onOpenAiAssistant?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [detailJobId, setDetailJobId] = useState<string>();
  const [page, setPage] = useState(1);
  const [remoteJob, setRemoteJob] = useState<JobRunSummary>();
  const [remoteLookupPending, setRemoteLookupPending] = useState(false);
  const [remoteLookupError, setRemoteLookupError] = useState<string>();
  const [resubmitPending, setResubmitPending] = useState(false);
  const cancelJob = useCancelJobRun();
  const startJob = useStartJobRun();
  const clusters = useVirtualClusters();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const setPendingSourceSubmit = useSessionStore((state) => state.setPendingSourceSubmit);
  const setPendingAiAnalyze = useSessionStore((state) => state.setPendingAiAnalyze);

  const submittedKeyword = keyword?.trim() || undefined;
  const useExternalClusterQuery = Boolean(clusterJobsQuery && !submittedOnly);
  const useExternalSubmissionQuery = Boolean(submissionJobsQuery && submittedOnly);
  const internalClusterJobs = useJobRuns(
    virtualClusterId,
    autoRefresh,
    submittedKeyword,
    !submittedOnly && !useExternalClusterQuery
  );
  const internalSubmissionJobs = useSubmissionHistory(
    virtualClusterId,
    autoRefresh,
    submittedOnly && !useExternalSubmissionQuery
  );
  const jobs = submittedOnly
    ? (submissionJobsQuery ?? internalSubmissionJobs)
    : (clusterJobsQuery ?? internalClusterJobs);

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
      toast.success(t("Found {name}", { name: job.name }));
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

  async function handleResubmit(job: JobRunSummary) {
    if (job.sourceRequest) {
      const templateLabel = job.sourceRequest.templateName?.trim() || job.name;
      startJob.mutate(job.sourceRequest, {
        onSuccess: () => {
          toast.success(t("Rerun · {name}", { name: templateLabel }));
          onSubmissionStarted?.();
        },
        onError: (error) => toast.error(errorMessage(error))
      });
      return;
    }

    setResubmitPending(true);
    try {
      let detailed = job;
      if (!job.describeDetails?.jobDriver) {
        detailed = await emrService.describeJobRun(job.id, job.virtualClusterId, accountId);
      }
      if (!isSparkSubmitDescribe(detailed)) {
        toast.error("Source Rerun currently supports sparkSubmit jobs only.");
        return;
      }
      const payload = describeJobToStartJobPayload(detailed);
      setPendingSourceSubmit({ payload, virtualClusterId: detailed.virtualClusterId });
      onOpenSubmit?.();
    } catch (error) {
      toast.error(formatAppError(error, "Failed to load job for Rerun."));
    } finally {
      setResubmitPending(false);
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {title || showAutoRefreshControl ? (
        <div className="flex shrink-0 items-center justify-between gap-2">
          {title ? (
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              {submittedOnly ? (
                <p className="text-xs text-muted-foreground">
                  {t("Latest {count} jobs submitted from this app for the selected virtual cluster.", {
                    count: SUBMISSION_HISTORY_LIMIT
                  })}
                </p>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("{count} jobs", { count: allJobs.length })}
            </span>
          )}
          {showAutoRefreshControl && onAutoRefreshChange ? (
            <JobAutoRefreshToggle
              id="submit-job-auto-refresh"
              autoRefresh={autoRefresh}
              onAutoRefreshChange={onAutoRefreshChange}
              isFetching={jobs.isFetching}
              refreshCountdown={refreshCountdown}
            />
          ) : null}
        </div>
      ) : null}

      {jobs.isLoading && allJobs.length === 0 ? (
        <p className="shrink-0 text-sm text-muted-foreground">
          {submittedOnly ? t("Loading recent submissions...") : t("Loading job history...")}
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
                <TableHead>{t("Job Name")}</TableHead>
                <TableHead>{t("State")}</TableHead>
                <TableHead>{t("Created Time")}</TableHead>
                <TableHead>{t("Duration")}</TableHead>
                <TableHead className="w-[360px] min-w-[360px] text-left">{t("Actions")}</TableHead>
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
                  <TableCell>{new Date(job.createdAt).toLocaleString(localeTag(locale))}</TableCell>
                  <TableCell>{formatJobRunDuration(job)}</TableCell>
                  <TableCell className="w-[360px] min-w-[360px]">
                    <div className="flex justify-start gap-2">
                      <JobDetailAction
                        job={job}
                        open={detailJobId === job.id}
                        onOpenChange={(open) => setDetailJobId(open ? job.id : undefined)}
                      />
                      <JobLogActions job={job} onOpenLogs={onOpenLogs} />
                      {job.state === "FAILED" && onOpenAiAssistant ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPendingAiAnalyze({
                              jobId: job.id,
                              jobName: job.name,
                              virtualClusterId: job.virtualClusterId
                            });
                            onOpenAiAssistant();
                          }}
                        >
                          <Sparkles data-icon="inline-start" />
                          {t("Analyze")}
                        </Button>
                      ) : null}
                      {job.state === "RUNNING" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={cancelJob.isPending}
                          onClick={() =>
                            cancelJob.mutate(
                              { id: job.id, virtualClusterId: job.virtualClusterId },
                              {
                                onSuccess: () => toast.success(t("Kill requested.")),
                                onError: (error) => toast.error(errorMessage(error))
                              }
                            )
                          }
                        >
                          <Skull data-icon="inline-start" />
                          {t("Kill")}
                        </Button>
                      ) : null}
                      {(job.state === "FAILED" || job.state === "CANCELLED") ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={startJob.isPending || resubmitPending}
                          onClick={() => {
                            void handleResubmit(job);
                          }}
                        >
                          <Play data-icon="inline-start" />
                          {t("Rerun")}
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
                          submittedOnly,
                          t
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
                          {remoteLookupPending ? t("Finding...") : t("Find in AWS")}
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
              {t("Page {page} of {pageCount}", { page, pageCount })}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                {t("Previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                {t("Next")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function JobLogActions({ job, onOpenLogs }: { job: JobRunSummary; onOpenLogs?: (job: JobRunSummary) => void }) {
  const t = useT();
  const setSelectedJobForLogs = useSessionStore((state) => state.setSelectedJobForLogs);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        // The store handoff stays: Submit Job's Recent Submissions table reaches
        // logs through the same callback from another page.
        setSelectedJobForLogs(job.id, job.virtualClusterId);
        onOpenLogs?.(job);
      }}
    >
      <FileText data-icon="inline-start" />
      {t("Logs")}
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
  return [job.name, job.id, job.state].some((value) => value.toLowerCase().includes(normalized));
}

function emptyJobsMessage({
  submittedKeyword,
  effectiveVirtualClusterId,
  isSyncingJobs,
  autoRefresh,
  submittedOnly = false,
  t
}: {
  submittedKeyword?: string;
  effectiveVirtualClusterId?: string;
  isSyncingJobs: boolean;
  autoRefresh: boolean;
  submittedOnly?: boolean;
  /** Threaded in because this helper is not a component and cannot call hooks. */
  t: Translator;
}) {
  if (submittedKeyword) {
    return t("No jobs match the current filters.");
  }
  if (isSyncingJobs) {
    return submittedOnly
      ? t("Loading recent submissions...")
      : autoRefresh
        ? t("Syncing job runs from AWS. Auto refresh is enabled.")
        : t("Loading job runs from AWS...");
  }
  if (!effectiveVirtualClusterId) {
    return submittedOnly
      ? t("Select a virtual cluster to see jobs submitted from this app.")
      : t("Select a virtual cluster to sync job runs from AWS.");
  }
  if (submittedOnly) {
    return autoRefresh
      ? t("No jobs submitted from this app yet. Auto refresh is enabled.")
      : t("No jobs submitted from this app for the selected virtual cluster.");
  }
  return autoRefresh
    ? t("No job runs found yet. Auto refresh will keep checking AWS.")
    : t("No job runs found for the selected virtual cluster.");
}
