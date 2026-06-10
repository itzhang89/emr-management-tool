import { useQuery } from "@tanstack/react-query";
import { cloudWatchLogsService } from "@/services/cloudWatchLogsService";
import type { JobLogsRequest } from "@/types/domain";

export function useJobLogs(request: JobLogsRequest | undefined, autoRefresh = false) {
  return useQuery({
    queryKey: ["job-logs", request],
    queryFn: () => cloudWatchLogsService.getJobLogs(request!),
    enabled: Boolean(request?.jobId),
    refetchInterval: autoRefresh ? 10_000 : false
  });
}
