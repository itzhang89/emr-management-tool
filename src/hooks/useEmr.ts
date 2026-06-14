import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListVirtualClustersRequest, StartJobRunRequest } from "@/types/domain";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { emrService } from "@/services/emrService";

const jobHistoryRefreshIntervalMs = 5_000;

function useActiveAccountId() {
  const activeAccount = useActiveAwsAccount();
  return activeAccount.data?.id;
}

export function useVirtualClusters(request: ListVirtualClustersRequest = {}) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["virtual-clusters", accountId ?? request.accountId, request.nextToken],
    queryFn: () => emrService.listVirtualClusters({ ...request, accountId: request.accountId ?? accountId }),
    enabled: Boolean(accountId ?? request.accountId)
  });
}

export function useJobRuns(virtualClusterId?: string, autoRefresh = false) {
  const accountId = useActiveAccountId();
  const query = useQuery({
    queryKey: ["job-runs", accountId, virtualClusterId],
    queryFn: () => emrService.listJobRuns(virtualClusterId, accountId),
    enabled: Boolean(accountId),
    staleTime: autoRefresh ? 0 : undefined,
    structuralSharing: !autoRefresh
  });

  useEffect(() => {
    if (!autoRefresh) return;

    void query.refetch({ cancelRefetch: false });
    const timer = window.setInterval(() => {
      void query.refetch({ cancelRefetch: false });
    }, jobHistoryRefreshIntervalMs);

    return () => window.clearInterval(timer);
  }, [autoRefresh, query.refetch, virtualClusterId]);

  return query;
}

export function useDescribeJobRun(id?: string, virtualClusterId?: string) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["job-run", accountId, id, virtualClusterId],
    queryFn: () => emrService.describeJobRun(id!, virtualClusterId!, accountId),
    enabled: Boolean(accountId && id && virtualClusterId)
  });
}

export function useStartJobRun() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: StartJobRunRequest) =>
      emrService.startJobRun({ ...request, accountId: request.accountId ?? accountId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["job-runs", accountId] })
  });
}

export function useCancelJobRun() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, virtualClusterId }: { id: string; virtualClusterId: string }) =>
      emrService.cancelJobRun(id, virtualClusterId, accountId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["job-runs", accountId] })
  });
}
