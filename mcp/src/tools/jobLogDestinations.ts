import type { BridgeJobDescribeDetails } from "../bridge/client.js";

/**
 * Mirrors the desktop app's `src/services/jobLogDestinations.ts`, so the MCP
 * tool resolves a job's S3/CloudWatch log destinations exactly the way the
 * Logs page does when the user clicks the "Logs" button. Keep the two in sync.
 */

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

export interface JobForLogDestinations {
  id: string;
  virtualClusterId: string;
  describeDetails?: {
    configurationOverrides?: BridgeJobDescribeDetails["configurationOverrides"];
  };
}

// Conventional EMR on EKS destination, used when a job has no monitoring
// configuration at all (logs then default to this CloudWatch group).
export function defaultCloudWatchDestination(
  job: Pick<JobForLogDestinations, "id">,
): CloudWatchLogDestination {
  return {
    logGroupName: `/aws/emr-containers/jobs/${job.id}`,
    streamNamePrefix: job.id,
  };
}

export function buildJobCloudWatchStreamPrefix(
  logStreamNamePrefix: string | undefined,
  virtualClusterId: string,
  jobId: string,
): string {
  const basePrefix = logStreamNamePrefix?.trim() ?? "";
  const normalizedBasePrefix =
    basePrefix && !basePrefix.endsWith("/") ? `${basePrefix}/` : basePrefix;
  return `${normalizedBasePrefix}${virtualClusterId}/jobs/${jobId}/`;
}

export function parseS3Uri(
  uri: string,
): { bucket: string; prefix: string } | undefined {
  const trimmed = uri.trim();
  const match = /^s3:\/\/([^/]+)\/?(.*)$/.exec(trimmed);
  if (!match) return undefined;

  const prefix = match[2] ?? "";
  return {
    bucket: match[1]!,
    prefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix,
  };
}

export function buildJobS3LogPrefix(
  logUri: string,
  virtualClusterId: string,
  jobId: string,
): S3LogDestination | undefined {
  const parsed = parseS3Uri(logUri);
  if (!parsed) return undefined;

  return {
    bucket: parsed.bucket,
    prefix: `${parsed.prefix}${virtualClusterId}/jobs/${jobId}/`,
  };
}

export function resolveJobLogDestinations(
  job: JobForLogDestinations,
): JobLogDestinations {
  const monitoring =
    job.describeDetails?.configurationOverrides?.monitoringConfiguration;
  const cloudWatchConfig = monitoring?.cloudWatchMonitoringConfiguration;
  const s3Config = monitoring?.s3MonitoringConfiguration;

  const destinations: JobLogDestinations = {};

  if (cloudWatchConfig?.logGroupName?.trim()) {
    destinations.cloudWatch = {
      logGroupName: cloudWatchConfig.logGroupName.trim(),
      streamNamePrefix: buildJobCloudWatchStreamPrefix(
        cloudWatchConfig.logStreamNamePrefix,
        job.virtualClusterId,
        job.id,
      ),
    };
  }

  if (s3Config?.logUri?.trim()) {
    destinations.s3 = buildJobS3LogPrefix(
      s3Config.logUri.trim(),
      job.virtualClusterId,
      job.id,
    );
  }

  return destinations;
}
