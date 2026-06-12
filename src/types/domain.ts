export type AwsRegion = string;

export interface AwsCredentialsInput {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: AwsRegion;
}

export interface AwsSettings {
  region: AwsRegion;
  hasSavedCredentials: boolean;
  identity?: AwsIdentity;
}

export interface AwsIdentity {
  account: string;
  arn: string;
  userId: string;
}

export interface AwsAccount {
  id: string;
  name: string;
  region: AwsRegion;
  accessKeyIdMasked: string;
  identity?: AwsIdentity;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AwsAccountSummary {
  id: string;
  name: string;
  region: AwsRegion;
  accessKeyIdMasked: string;
  identity?: AwsIdentity;
  isActive: boolean;
}

export interface AwsAccountCredentialsInput {
  id?: string;
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: AwsRegion;
  makeActive: boolean;
}

export interface AwsCliProfileSummary {
  profileName: string;
  region?: AwsRegion;
  accessKeyIdMasked?: string;
  canImport: boolean;
  importError?: string;
}

export interface ImportAwsCliProfileRequest {
  profileName: string;
  name?: string;
  makeActive: boolean;
}

export interface AwsCommandContext {
  accountId?: string;
}

export interface VirtualCluster {
  id: string;
  name: string;
  state: "RUNNING" | "TERMINATING" | "TERMINATED" | "ARRESTED" | "UNKNOWN";
  namespace: string;
  eksClusterName: string;
  createdAt: string;
}

export interface ListVirtualClustersRequest extends AwsCommandContext {
  nextToken?: string;
  maxResults?: number;
}

export interface ListVirtualClustersResponse {
  clusters: VirtualCluster[];
  nextToken?: string;
}

export type JobState = "PENDING" | "SUBMITTED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface JobRunDescribeJobDriver {
  type: "sparkSubmit" | "sparkSql";
  entryPoint?: string;
  entryPointArguments?: string[];
  sparkSubmitParameters?: string;
  sparkSqlParameters?: string;
}

export interface CloudWatchMonitoringConfiguration {
  logGroupName?: string;
  logStreamNamePrefix?: string;
}

export interface S3MonitoringConfiguration {
  logUri?: string;
}

export interface JobRunMonitoringConfiguration {
  persistentAppUi?: string;
  cloudWatchMonitoringConfiguration?: CloudWatchMonitoringConfiguration;
  s3MonitoringConfiguration?: S3MonitoringConfiguration;
}

export interface JobRunConfigurationOverrides {
  applicationConfiguration?: unknown[];
  monitoringConfiguration?: JobRunMonitoringConfiguration;
}

export interface JobRunDescribeDetails {
  arn?: string;
  clientToken?: string;
  executionRoleArn?: string;
  releaseLabel?: string;
  createdBy?: string;
  stateDetails?: string;
  failureReason?: string;
  tags?: Record<string, string>;
  retryMaxAttempts?: number;
  retryCurrentAttemptCount?: number;
  jobDriver?: JobRunDescribeJobDriver;
  configurationOverrides?: JobRunConfigurationOverrides;
}

export interface JobRunSummary {
  id: string;
  name: string;
  state: JobState;
  accountId?: string;
  region?: string;
  virtualClusterId: string;
  virtualClusterName?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
  sourceRequest?: StartJobRunRequest;
  describeDetails?: JobRunDescribeDetails;
}

export interface SparkResourceConfig {
  driverCores: number;
  driverMemory: string;
  executorCores: number;
  executorMemory: string;
  executorInstances: number;
}

export interface JarApplicationConfig {
  type: "jar";
  jarPath: string;
  mainClass: string;
}

export interface SubmitJobFormValues {
  name: string;
  virtualClusterId: string;
  executionRoleArn: string;
  releaseLabel: string;
  application: JarApplicationConfig;
  arguments: string[];
  resources: SparkResourceConfig;
  sparkConfig: Record<string, string>;
}

export interface StartJobRunRequest extends SubmitJobFormValues {
  accountId?: string;
  jobDriver: {
    sparkSubmitJobDriver: {
      entryPoint: string;
      entryPointArguments: string[];
      sparkSubmitParameters: string;
    };
  };
}

export interface ApplicationTemplate {
  id: string;
  name: string;
  description: string;
  jarPath: string;
  mainClass: string;
  defaultArguments: string[];
  sparkConfig: Record<string, string>;
  resourceTemplateId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceTemplate {
  id: string;
  name: string;
  resources: SparkResourceConfig;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  streamName: string;
}

export interface JobLogsResponse {
  jobId: string;
  entries: LogEntry[];
  nextForwardToken?: string;
}

export interface JobLogsRequest extends AwsCommandContext {
  jobId: string;
  nextForwardToken?: string;
  logGroupName?: string;
  streamNamePrefix?: string;
  filterPattern?: string;
  limit?: number;
}

export interface S3Bucket {
  name: string;
  createdAt?: string;
}

export interface S3ObjectEntry {
  bucket: string;
  key: string;
  kind: "folder" | "file";
  size: number;
  lastModified?: string;
  etag?: string;
}

export interface S3TextObject {
  accountId?: string;
  bucket: string;
  key: string;
  content: string;
  etag?: string;
  contentType?: string;
  lastModified?: string;
}

export interface AppError {
  kind: "aws" | "storage" | "validation" | "internal" | "demo";
  code: string;
  message: string;
  service?: string;
  requestId?: string;
  retryable?: boolean;
  accountId?: string;
}
