export type AwsRegion = string;

export interface AwsCredentialsInput {
  accessKeyId: string;
  secretAccessKey: string;
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

export interface VirtualCluster {
  id: string;
  name: string;
  state: "RUNNING" | "TERMINATING" | "TERMINATED" | "ARRESTED" | "UNKNOWN";
  namespace: string;
  eksClusterName: string;
  createdAt: string;
}

export type JobState = "PENDING" | "SUBMITTED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface JobRunSummary {
  id: string;
  name: string;
  state: JobState;
  virtualClusterId: string;
  virtualClusterName?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
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
  bucket: string;
  key: string;
  content: string;
  etag?: string;
  contentType?: string;
  lastModified?: string;
}

export interface AppError {
  code: string;
  message: string;
  service?: string;
}
