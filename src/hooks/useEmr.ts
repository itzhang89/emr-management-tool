import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StartJobRunRequest } from "@/types/domain";
import { emrService } from "@/services/emrService";

export function useVirtualClusters(region: string) {
  return useQuery({
    queryKey: ["virtual-clusters", region],
    queryFn: () => emrService.listVirtualClusters(region)
  });
}

export function useJobRuns(virtualClusterId?: string) {
  return useQuery({
    queryKey: ["job-runs", virtualClusterId],
    queryFn: () => emrService.listJobRuns(virtualClusterId)
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
