import { useQuery } from "@tanstack/react-query";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { cloudWatchLogsService } from "@/services/cloudWatchLogsService";
import { s3Service } from "@/services/s3Service";
import type { JobLogsRequest, JobLogStreamsRequest, S3JobLogObjectsRequest } from "@/types/domain";

const logQueryOptions = {
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  placeholderData: <T,>(previousData: T | undefined) => previousData
} as const;

export function useJobLogStreams(request: JobLogStreamsRequest | undefined, autoRefresh = false) {
  const accountId = useActiveAwsAccount().data?.id;

  return useQuery({
    // Every log key carries the account: job run ids are only unique within an
    // account, so without it switching accounts can serve one account's logs
    // for another's job.
    queryKey: ["job-log-streams", accountId, request],
    queryFn: () => cloudWatchLogsService.listJobLogStreams(request!),
    enabled: Boolean(request?.jobId && request.logGroupName && request.streamNamePrefix),
    refetchInterval: autoRefresh ? 10_000 : false,
    ...logQueryOptions
  });
}

export function useJobLogs(request: JobLogsRequest | undefined, autoRefresh = false) {
  const accountId = useActiveAwsAccount().data?.id;

  return useQuery({
    queryKey: ["job-logs", accountId, request],
    queryFn: () => cloudWatchLogsService.getJobLogs(request!),
    enabled: Boolean(request?.jobId),
    refetchInterval: autoRefresh ? 10_000 : false,
    ...logQueryOptions
  });
}

export function useS3JobLogObjects(request: S3JobLogObjectsRequest | undefined) {
  const accountId = useActiveAwsAccount().data?.id;

  return useQuery({
    queryKey: ["s3-job-log-objects", accountId, request],
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
