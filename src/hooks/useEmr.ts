import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListVirtualClustersRequest, StartJobRunRequest } from "@/types/domain";
import { emrService } from "@/services/emrService";

export function useVirtualClusters(request: ListVirtualClustersRequest = {}) {
  return useQuery({
    queryKey: ["virtual-clusters", request.accountId, request.nextToken],
    queryFn: () => emrService.listVirtualClusters(request)
  });
}

export function useJobRuns(virtualClusterId?: string, autoRefresh = false) {
  return useQuery({
    queryKey: ["job-runs", virtualClusterId],
    queryFn: () => emrService.listJobRuns(virtualClusterId),
    refetchInterval: autoRefresh ? 5_000 : false
  });
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
