import type { JobRunConfigurationOverrides, JobRunSummary } from "@/types/domain";

export interface CloudWatchLogDestination {
  logGroupName: string;
  streamNamePrefix?: string;
}

export interface S3LogDestination {
  bucket: string;
  prefix: string;
}

export interface JobLogDestinations {
  cloudWatch?: CloudWatchLogDestination;
  s3?: S3LogDestination;
}

export function defaultCloudWatchDestination(job: Pick<JobRunSummary, "id">): CloudWatchLogDestination {
  return {
    logGroupName: `/aws/emr-containers/jobs/${job.id}`,
    streamNamePrefix: job.id
  };
}

export function parseS3Uri(uri: string): { bucket: string; prefix: string } | undefined {
  const trimmed = uri.trim();
  const match = /^s3:\/\/([^/]+)\/?(.*)$/.exec(trimmed);
  if (!match) return undefined;

  const prefix = match[2] ?? "";
  return {
    bucket: match[1],
    prefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix
  };
}

export function buildJobS3LogPrefix(logUri: string, virtualClusterId: string, jobId: string): S3LogDestination | undefined {
  const parsed = parseS3Uri(logUri);
  if (!parsed) return undefined;

  const jobPrefix = `${virtualClusterId}/jobs/${jobId}/`;
  return {
    bucket: parsed.bucket,
    prefix: `${parsed.prefix}${jobPrefix}`
  };
}

export function getMonitoringConfiguration(
  job: Pick<JobRunSummary, "describeDetails">
): JobRunConfigurationOverrides["monitoringConfiguration"] | undefined {
  const overrides = job.describeDetails?.configurationOverrides as JobRunConfigurationOverrides | undefined;
  return overrides?.monitoringConfiguration;
}

export function resolveJobLogDestinations(job: JobRunSummary): JobLogDestinations {
  const monitoring = getMonitoringConfiguration(job);
  const cloudWatchConfig = monitoring?.cloudWatchMonitoringConfiguration;
  const s3Config = monitoring?.s3MonitoringConfiguration;

  const destinations: JobLogDestinations = {};

  if (cloudWatchConfig?.logGroupName?.trim()) {
    destinations.cloudWatch = {
      logGroupName: cloudWatchConfig.logGroupName.trim(),
      streamNamePrefix: cloudWatchConfig.logStreamNamePrefix?.trim() || undefined
    };
  }

  if (s3Config?.logUri?.trim()) {
    destinations.s3 = buildJobS3LogPrefix(s3Config.logUri.trim(), job.virtualClusterId, job.id);
  }

  return destinations;
}
