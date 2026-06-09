import { useQuery } from "@tanstack/react-query";
import { cloudWatchLogsService } from "@/services/cloudWatchLogsService";

export function useJobLogs(jobId?: string, nextForwardToken?: string, autoRefresh = false) {
  return useQuery({
    queryKey: ["job-logs", jobId, nextForwardToken],
    queryFn: () => cloudWatchLogsService.getJobLogs(jobId!, nextForwardToken),
    enabled: Boolean(jobId),
    refetchInterval: autoRefresh ? 10_000 : false
  });
}
