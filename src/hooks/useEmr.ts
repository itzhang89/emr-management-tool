import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { JobRunSummary, ListVirtualClustersRequest, StartJobRunRequest } from "@/types/domain";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { emrService } from "@/services/emrService";
import { JOB_HISTORY_REFRESH_INTERVAL_MS } from "@/services/jobHistoryConstants";

function useActiveAccountId() {
  const activeAccount = useActiveAwsAccount();
  return activeAccount.data?.id;
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
  enabled = true
) {
  const accountId = useActiveAccountId();
  const normalizedVirtualClusterId = virtualClusterId?.trim() || undefined;
  return useQuery({
    queryKey: ["job-runs", accountId, normalizedVirtualClusterId, keyword],
    queryFn: () => emrService.listJobRuns(normalizedVirtualClusterId, accountId, keyword),
    enabled: enabled && Boolean(accountId),
    staleTime: autoRefresh ? 0 : undefined,
    structuralSharing: !autoRefresh,
    refetchInterval: autoRefresh && enabled ? JOB_HISTORY_REFRESH_INTERVAL_MS : false
  });
}

export function useSubmissionHistory(virtualClusterId?: string, autoRefresh = false, enabled = true) {
  const accountId = useActiveAccountId();
  const normalizedVirtualClusterId = virtualClusterId?.trim() || undefined;
  return useQuery({
    queryKey: ["submission-history", accountId, normalizedVirtualClusterId],
    queryFn: () => emrService.listSubmissionHistory(normalizedVirtualClusterId, accountId),
    enabled: enabled && Boolean(accountId && normalizedVirtualClusterId),
    staleTime: autoRefresh ? 0 : undefined,
    structuralSharing: !autoRefresh,
    refetchInterval: autoRefresh && enabled ? JOB_HISTORY_REFRESH_INTERVAL_MS : false
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
