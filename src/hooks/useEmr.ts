import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListVirtualClustersRequest, StartJobRunRequest } from "@/types/domain";
import { emrService } from "@/services/emrService";

const jobHistoryRefreshIntervalMs = 5_000;

export function useVirtualClusters(request: ListVirtualClustersRequest = {}) {
  return useQuery({
    queryKey: ["virtual-clusters", request.accountId, request.nextToken],
    queryFn: () => emrService.listVirtualClusters(request)
  });
}

export function useJobRuns(virtualClusterId?: string, autoRefresh = false) {
  const query = useQuery({
    queryKey: ["job-runs", virtualClusterId],
    queryFn: () => emrService.listJobRuns(virtualClusterId),
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
  return useQuery({
    queryKey: ["job-run", id, virtualClusterId],
    queryFn: () => emrService.describeJobRun(id!, virtualClusterId!),
    enabled: Boolean(id && virtualClusterId)
  });
}

export function useStartJobRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: StartJobRunRequest) => emrService.startJobRun(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["job-runs"] })
  });
}

export function useCancelJobRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, virtualClusterId }: { id: string; virtualClusterId: string }) =>
      emrService.cancelJobRun(id, virtualClusterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["job-runs"] })
  });
}
