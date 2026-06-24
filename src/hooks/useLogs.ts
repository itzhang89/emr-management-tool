import { useQuery } from "@tanstack/react-query";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { cloudWatchLogsService } from "@/services/cloudWatchLogsService";
import { s3Service } from "@/services/s3Service";
import type { JobLogsRequest, JobLogStreamsRequest, S3JobLogObjectsRequest } from "@/types/domain";

const logQueryOptions = {
  staleTime: 60_000,
  gcTime: 5 * 60_000
} as const;

export function useJobLogStreams(request: JobLogStreamsRequest | undefined, autoRefresh = false) {
  return useQuery({
    queryKey: ["job-log-streams", request],
    queryFn: () => cloudWatchLogsService.listJobLogStreams(request!),
    enabled: Boolean(request?.jobId && request.logGroupName && request.streamNamePrefix),
    refetchInterval: autoRefresh ? 10_000 : false,
    ...logQueryOptions
  });
}

export function useJobLogs(request: JobLogsRequest | undefined, autoRefresh = false) {
  return useQuery({
    queryKey: ["job-logs", request],
    queryFn: () => cloudWatchLogsService.getJobLogs(request!),
    enabled: Boolean(request?.jobId),
    refetchInterval: autoRefresh ? 10_000 : false,
    ...logQueryOptions
  });
}

export function useS3JobLogObjects(request: S3JobLogObjectsRequest | undefined) {
  return useQuery({
    queryKey: ["s3-job-log-objects", request],
    queryFn: () => s3Service.listJobLogObjects(request!),
    enabled: Boolean(request?.bucket && request.prefix),
    ...logQueryOptions
  });
}

export function useS3JobLogObject(bucket?: string, key?: string) {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;

  return useQuery({
    queryKey: ["s3-job-log-object", accountId, bucket, key],
    queryFn: () => s3Service.getJobLogObject(accountId!, bucket!, key!),
    enabled: Boolean(accountId && bucket && key),
    staleTime: 60_000,
    gcTime: 5 * 60_000
  });
}
