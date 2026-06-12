import { useQuery } from "@tanstack/react-query";
import { cloudWatchLogsService } from "@/services/cloudWatchLogsService";
import { s3Service } from "@/services/s3Service";
import type { JobLogsRequest, JobLogStreamsRequest, S3JobLogObjectsRequest } from "@/types/domain";

export function useJobLogStreams(request: JobLogStreamsRequest | undefined, autoRefresh = false) {
  return useQuery({
    queryKey: ["job-log-streams", request],
    queryFn: () => cloudWatchLogsService.listJobLogStreams(request!),
    enabled: Boolean(request?.jobId && request.logGroupName && request.streamNamePrefix),
    refetchInterval: autoRefresh ? 10_000 : false
  });
}

export function useJobLogs(request: JobLogsRequest | undefined, autoRefresh = false) {
  return useQuery({
    queryKey: ["job-logs", request],
    queryFn: () => cloudWatchLogsService.getJobLogs(request!),
    enabled: Boolean(request?.jobId),
    refetchInterval: autoRefresh ? 10_000 : false
  });
}

export function useS3JobLogObjects(request: S3JobLogObjectsRequest | undefined) {
  return useQuery({
    queryKey: ["s3-job-log-objects", request],
    queryFn: () => s3Service.listJobLogObjects(request!),
    enabled: Boolean(request?.bucket && request.prefix)
  });
}

export function useS3JobLogObject(bucket?: string, key?: string) {
  return useQuery({
    queryKey: ["s3-job-log-object", bucket, key],
    queryFn: () => s3Service.getJobLogObject(bucket!, key!),
    enabled: Boolean(bucket && key)
  });
}
