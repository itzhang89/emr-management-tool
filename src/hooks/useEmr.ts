import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import type { JobRunSummary, ListVirtualClustersRequest, StartJobRunRequest } from "@/types/domain";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { formatAppError, isAwsThrottleError } from "@/services/appErrorMessage";
import { emrService } from "@/services/emrService";
import {
  AWS_THROTTLE_PAUSE_MS,
  JOB_HISTORY_REFRESH_INTERVAL_MS
} from "@/services/jobHistoryConstants";

function useActiveAccountId() {
  const activeAccount = useActiveAwsAccount();
  return activeAccount.data?.id;
}

function noteThrottlePause(throttleUntilRef: { current: number }, error: unknown, toastId: string) {
  if (!isAwsThrottleError(error)) return false;
  throttleUntilRef.current = Date.now() + AWS_THROTTLE_PAUSE_MS;
  toast.error(formatAppError(error, "AWS rate limit reached. Pausing auto-refresh briefly."), {
    id: toastId
  });
  return true;
}

export function useVirtualClusters(request: ListVirtualClustersRequest = {}) {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const region = activeAccount.data?.region;

  return useQuery({
    queryKey: ["virtual-clusters", accountId ?? request.accountId, region, request.nextToken],
    queryFn: () => emrService.listVirtualClusters({ ...request, accountId: request.accountId ?? accountId }),
    enabled: Boolean(accountId ?? request.accountId)
  });
}

export function useJobRuns(
  virtualClusterId?: string,
  autoRefresh = false,
  keyword?: string,
  enabled = true,
  createdAfterDays?: number
) {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();
  const normalizedVirtualClusterId = virtualClusterId?.trim() || undefined;
  const normalizedKeyword = keyword?.trim() || undefined;
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const throttleUntilRef = useRef(0);

  const query = useQuery({
    queryKey: ["job-runs", accountId, normalizedVirtualClusterId, normalizedKeyword, createdAfterDays],
    queryFn: () =>
      emrService.listJobRuns(normalizedVirtualClusterId, accountId, normalizedKeyword, createdAfterDays),
    enabled: enabled && Boolean(accountId),
    staleTime: autoRefresh ? 0 : undefined,
    structuralSharing: !autoRefresh,
    // Local reads only; AWS sync runs in a separate effect so the table stays interactive.
    refetchInterval: false
  });

  useEffect(() => {
    if (!enabled || !accountId || !normalizedVirtualClusterId || normalizedKeyword) {
      setBackgroundSyncing(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const scheduleNext = () => {
      if (!autoRefresh || cancelled) return;
      if (timeoutId) clearTimeout(timeoutId);
      const remainingThrottle = throttleUntilRef.current - Date.now();
      const waitMs =
        remainingThrottle > 0
          ? Math.max(remainingThrottle, JOB_HISTORY_REFRESH_INTERVAL_MS)
          : JOB_HISTORY_REFRESH_INTERVAL_MS;
      timeoutId = setTimeout(() => {
        void syncFromAws();
      }, waitMs);
    };

    const syncFromAws = async () => {
      if (cancelled || inFlight) return;
      if (Date.now() < throttleUntilRef.current) {
        scheduleNext();
        return;
      }

      inFlight = true;
      setBackgroundSyncing(true);
      try {
        await emrService.syncJobRuns(normalizedVirtualClusterId, accountId, createdAfterDays);
        if (!cancelled) {
          await queryClient.invalidateQueries({
            queryKey: ["job-runs", accountId, normalizedVirtualClusterId]
          });
        }
      } catch (error) {
        if (!cancelled) {
          const throttled = noteThrottlePause(
            throttleUntilRef,
            error,
            `job-runs-sync-throttle:${accountId}:${normalizedVirtualClusterId}`
          );
          if (!throttled) {
            toast.error(formatAppError(error, "Failed to sync job runs from AWS."), {
              id: `job-runs-sync:${accountId}:${normalizedVirtualClusterId}`
            });
          }
        }
      } finally {
        inFlight = false;
        if (!cancelled) setBackgroundSyncing(false);
        scheduleNext();
      }
    };

    void syncFromAws();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    accountId,
    autoRefresh,
    createdAfterDays,
    enabled,
    normalizedKeyword,
    normalizedVirtualClusterId,
    queryClient
  ]);

  return {
    ...query,
    isFetching: query.isFetching || backgroundSyncing
  };
}

export function useSubmissionHistory(virtualClusterId?: string, autoRefresh = false, enabled = true) {
  const accountId = useActiveAccountId();
  const normalizedVirtualClusterId = virtualClusterId?.trim() || undefined;
  const throttleUntilRef = useRef(0);

  return useQuery({
    queryKey: ["submission-history", accountId, normalizedVirtualClusterId],
    queryFn: async () => {
      try {
        return await emrService.listSubmissionHistory(normalizedVirtualClusterId, accountId);
      } catch (error) {
        noteThrottlePause(
          throttleUntilRef,
          error,
          `submission-history-throttle:${accountId}:${normalizedVirtualClusterId}`
        );
        throw error;
      }
    },
    enabled: enabled && Boolean(accountId && normalizedVirtualClusterId),
    staleTime: autoRefresh ? 0 : undefined,
    structuralSharing: !autoRefresh,
    refetchInterval: () => {
      if (!autoRefresh || !enabled) return false;
      const throttleWait = throttleUntilRef.current - Date.now();
      if (throttleWait > 0) return throttleWait;
      return JOB_HISTORY_REFRESH_INTERVAL_MS;
    }
  });
}

export function useDescribeJobRun(id?: string, virtualClusterId?: string) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["job-run", accountId, id, virtualClusterId],
    queryFn: () => emrService.describeJobRun(id!, virtualClusterId!, accountId),
    enabled: Boolean(accountId && id && virtualClusterId),
    staleTime: 60_000
  });
}

export function useStartJobRun() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: StartJobRunRequest) =>
      emrService.startJobRun({ ...request, accountId: request.accountId ?? accountId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-runs", accountId] });
      queryClient.invalidateQueries({ queryKey: ["submission-history", accountId] });
    }
  });
}

export function useCancelJobRun() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, virtualClusterId }: { id: string; virtualClusterId: string }) =>
      emrService.cancelJobRun(id, virtualClusterId, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-runs", accountId] });
      queryClient.invalidateQueries({ queryKey: ["submission-history", accountId] });
    }
  });
}

export type JobRunsQuery = UseQueryResult<JobRunSummary[]>;
