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
  configurationOverrides?: JobRunConfigurationOverrides;
}

export type TemplateVariableType =
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "multiEnum"
  | "date"
  | "dateTime";

export interface TemplateVariableDefinition {
  name: string;
  label?: string;
  description?: string;
  type: TemplateVariableType;
  defaultValue?: string | number | boolean | string[];
  options?: string[];
  format?: string;
  required?: boolean;
}

export interface JobConfigTemplate {
  id: string;
  accountId?: string;
  name: string;
  description?: string;
  payloadTemplate: string;
  customVariables: TemplateVariableDefinition[];
  defaultResourceTemplateId?: string;
  builtIn?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedJobPayload {
  name: string;
  virtualClusterId: string;
  executionRoleArn: string;
  releaseLabel: string;
  jobDriver: {
    sparkSubmitJobDriver: {
      entryPoint: string;
      entryPointArguments?: string[];
      sparkSubmitParameters?: string;
    };
  };
  configurationOverrides?: JobRunConfigurationOverrides;
}

export interface TemplateResolveContext {
  templateName: string;
  virtualClusterId: string;
  submitUser: string;
  customVariables: Record<string, string | number | boolean | string[]>;
  now?: Date;
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

export type JobLogType = "controller" | "driver" | "executor";
export type JobLogSource = "cloudwatch" | "s3";
export type JobLogOutputStream = "stdout" | "stderr" | string;

export interface JobLogStream {
  source: "cloudwatch";
  id: string;
  label: string;
  type: JobLogType;
  container: string;
  pod: string;
  stream: JobLogOutputStream;
  cloudWatchStreamName: string;
  lastEventTimestamp?: string;
}

export interface JobLogObject {
  source: "s3";
  id: string;
  label: string;
  type: JobLogType;
  container: string;
  pod: string;
  stream: JobLogOutputStream;
  s3Key: string;
  size: number;
  lastModified?: string;
}

export interface JobLogGroup {
  label: string;
  items: Array<JobLogStream | JobLogObject>;
}

export interface JobLogTreeSection {
  type: JobLogType;
  label: string;
  groups: JobLogGroup[];
}

export interface JobLogStreamsRequest extends AwsCommandContext {
  jobId: string;
  logGroupName: string;
  streamNamePrefix: string;
  nextToken?: string;
}

export interface JobLogStreamsResponse {
  jobId: string;
  streams: JobLogStream[];
  nextToken?: string;
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
  logStreamName?: string;
  logType?: "driver" | "executor" | "controller" | "all";
  filterPattern?: string;
  limit?: number;
}

export interface S3Bucket {
  name: string;
  createdAt?: string;
  region?: string;
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

export interface S3PrefixDeletionSummary {
  prefix: string;
  fileCount: number;
  folderCount: number;
  totalObjectCount: number;
  totalBytes: number;
  truncated: boolean;
}

export interface S3JobLogObjectsRequest extends AwsCommandContext {
  bucket: string;
  prefix: string;
  continuationToken?: string;
}

export interface S3JobLogObjectsResponse {
  bucket: string;
  objects: JobLogObject[];
  nextToken?: string;
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

export interface GlueListRequest extends AwsCommandContext {
  catalogId?: string;
  databaseName?: string;
  nextToken?: string;
  maxResults?: number;
}

export interface GlueDatabase {
  name: string;
  description?: string;
  locationUri?: string;
}

export interface GlueListDatabasesResponse {
  databases: GlueDatabase[];
  nextToken?: string;
}

export interface GlueTableSummary {
  name: string;
  databaseName: string;
  tableType?: string;
  createTime?: string;
}

export interface GlueListTablesResponse {
  tables: GlueTableSummary[];
  nextToken?: string;
}

export interface GlueColumn {
  name: string;
  type: string;
  comment?: string;
}

export interface GlueTableDetail {
  name: string;
  databaseName: string;
  catalogId: string;
  description?: string;
  tableType?: string;
  owner?: string;
  createTime?: string;
  updateTime?: string;
  parameters: Record<string, string>;
  columns: GlueColumn[];
  partitionKeys: GlueColumn[];
  location?: string;
  inputFormat?: string;
  outputFormat?: string;
  serdeLibrary?: string;
  serdeParameters: Record<string, string>;
}

export interface GlueGetTableRequest extends AwsCommandContext {
  catalogId?: string;
  databaseName: string;
  tableName: string;
}

export interface GlueUpdateTableRequest extends AwsCommandContext {
  catalogId?: string;
  table: GlueTableDetail;
}

export interface AthenaWorkgroup {
  name: string;
  description?: string;
  state?: string;
  managedResultsEnabled?: boolean;
  enforceConfiguration?: boolean;
  outputLocation?: string;
  sparkEnabled?: boolean;
  effectiveEngineVersion?: string;
}

export interface StartAthenaQueryRequest extends AwsCommandContext {
  sql: string;
  database?: string;
  workgroup: string;
  outputLocation?: string;
  catalog?: string;
}

export interface AthenaQueryExecutionRequest extends AwsCommandContext {
  queryExecutionId: string;
}

export type AthenaQueryState = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";

export interface AthenaQueryExecution {
  queryExecutionId: string;
  state: AthenaQueryState;
  stateChangeReason?: string;
  submissionDateTime?: string;
  completionDateTime?: string;
  dataScannedBytes?: number;
  engineExecutionTimeMs?: number;
}

export interface AthenaQueryResultsRequest extends AwsCommandContext {
  queryExecutionId: string;
  nextToken?: string;
  maxResults?: number;
}

export interface AthenaQueryResults {
  columnNames: string[];
  rows: string[][];
  nextToken?: string;
}

export interface ExportAthenaQueryCsvRequest extends AwsCommandContext {
  queryExecutionId: string;
  suggestedName: string;
}

export interface SqlHistoryEntry {
  id: string;
  sql: string;
  submittedAt: string;
}

export interface SqlFavoriteEntry {
  id: string;
  name: string;
  sql: string;
  createdAt: string;
}

export interface AthenaAccountPreferences {
  outputBasePath?: string;
  appendSubmitUser?: boolean;
  lastWorkgroup?: string;
  catalogCollapsed?: boolean;
  lastDatabase?: string;
  querySettingsIntroSeen?: boolean;
}
