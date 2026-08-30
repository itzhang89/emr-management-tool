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

export interface AwsAccountUpdateInput {
  accountId: string;
  name: string;
  region: AwsRegion;
  secretAccessKey?: string;
}

export interface TestAwsAccountRequest {
  accountId: string;
  region: AwsRegion;
  secretAccessKey?: string;
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
  region?: AwsRegion;
  makeActive: boolean;
}

export interface AwsCliProfileCredentials {
  profileName: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: AwsRegion;
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
  /** Job config template name when submitted from Template mode; kept for Rerun toast. */
  templateName?: string;
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

export interface S3UploadPrepareResult {
  localPath: string;
  fileName: string;
  key: string;
  bucket: string;
  totalBytes: number;
  exists: boolean;
  suggestedFileName?: string;
}

export interface S3UploadFromPathRequest {
  accountId?: string;
  bucket: string;
  key: string;
  localPath: string;
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

export interface GlueDatabaseDetail {
  name: string;
  catalogId: string;
  description?: string;
  locationUri?: string;
  createTime?: string;
  parameters: Record<string, string>;
}

export interface GlueGetDatabaseRequest extends AwsCommandContext {
  catalogId?: string;
  databaseName: string;
}

export interface GlueUpdateDatabaseRequest extends AwsCommandContext {
  catalogId?: string;
  database: GlueDatabaseDetail;
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
  skipCreateLocationReminder?: boolean;
}

export interface PortableUpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string;
  url: string;
  signature: string;
}

export interface McpStatus {
  running: boolean;
  mcpPort?: number;
  endpointUrl?: string;
}

/** One MCP tool invocation from the audit database (mcp_audit table). */
export interface McpAuditEntry {
  id: string;
  timestamp: string;
  /** "success" | "error" */
  status: string;
  tool: string;
  client?: string | null;
  durationMs: number;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  error?: string | null;
}

// --- LLM provider configuration -------------------------------------------
// A three-level structure: provider → endpoint → model. API keys are never part
// of these types — an endpoint reports `hasApiKey` plus a masked value that can
// be replaced but not read back.

/**
 * Which request/response shape an endpoint speaks — not a vendor name. An
 * OpenAI-compatible gateway is "openai" no matter who runs it.
 */
export type LlmProviderKind = "openai" | "anthropic";

export interface LlmModel {
  id: string;
  endpointId: string;
  /** The value sent to the API, e.g. "claude-opus-4-8". */
  modelId: string;
  /** Grouping label in the model tree, e.g. "claude-opus". */
  series: string;
  displayName?: string | null;
  isDefault: boolean;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  createdAt: string;
}

export interface LlmEndpoint {
  id: string;
  providerId: string;
  name: string;
  baseUrl: string;
  isDefault: boolean;
  hasApiKey: boolean;
  /** e.g. "sk-••••abcd". Display only — the real key stays in the keychain. */
  apiKeyMasked?: string | null;
  createdAt: string;
  updatedAt: string;
  models: LlmModel[];
}

export interface LlmProvider {
  id: string;
  name: string;
  kind: LlmProviderKind;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  endpoints: LlmEndpoint[];
}

export interface CreateLlmProviderRequest {
  name: string;
  kind: LlmProviderKind;
}

export interface UpdateLlmProviderRequest {
  id: string;
  name?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface CreateLlmEndpointRequest {
  providerId: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  isDefault?: boolean;
}

/** Omit `apiKey` to leave the stored key untouched; pass "" to clear it. */
export interface UpdateLlmEndpointRequest {
  id: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  isDefault?: boolean;
}

export interface LlmEndpointTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  modelCount?: number | null;
}

/** A model the endpoint advertises, before the user chooses to import it. */
export interface LlmModelCandidate {
  modelId: string;
  series: string;
  displayName?: string | null;
  alreadyAdded: boolean;
}

export interface AddLlmModelInput {
  modelId: string;
  series?: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface AddLlmModelsRequest {
  endpointId: string;
  models: AddLlmModelInput[];
}

export interface UpdateLlmModelRequest {
  id: string;
  series?: string;
  displayName?: string;
  isDefault?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
}

// --- Chat ------------------------------------------------------------------
// Two levels: an assistant is a preset (system prompt, default model, which
// tools it may use), and a session is one conversation with that assistant.

export interface ChatAssistant {
  id: string;
  name: string;
  systemPrompt?: string | null;
  /** `LlmModel.id`, not the API's model id. */
  defaultModelId?: string | null;
  /** null means every MCP tool is available. */
  enabledTools?: string[] | null;
  accent?: string | null;
  sortOrder: number;
  /** The seeded "EMR failure analysis" assistant, which cannot be deleted. */
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSession {
  id: string;
  assistantId: string;
  title: string;
  /** Overrides the assistant's default model for this conversation. */
  modelId?: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * "context_reset" is a real stored message, not a deletion: history stays
 * readable while the next request starts from after the marker.
 */
export type ChatRole = "user" | "assistant" | "tool" | "context_reset";

export interface ChatToolCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  durationMs?: number | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  /** Monotonic within a session; the sort key. */
  seq: number;
  role: ChatRole;
  content?: string | null;
  toolCalls: ChatToolCall[];
  modelId?: string | null;
  durationMs?: number | null;
  error?: string | null;
  createdAt: string;
}

export interface CreateChatAssistantRequest {
  name: string;
  systemPrompt?: string;
  defaultModelId?: string;
  enabledTools?: string[];
  accent?: string;
}

/** Omit a field to leave it unchanged; pass `enabledTools: null` to allow all. */
export interface UpdateChatAssistantRequest {
  id: string;
  name?: string;
  systemPrompt?: string;
  defaultModelId?: string;
  enabledTools?: string[] | null;
  accent?: string;
  sortOrder?: number;
}

export interface CreateChatSessionRequest {
  assistantId: string;
  title?: string;
  modelId?: string;
}

export interface UpdateChatSessionRequest {
  id: string;
  title?: string;
  modelId?: string;
}

// --- Chat streaming events -------------------------------------------------
// Emitted by the Rust chat loop while `chat_send` runs, so the UI streams rather
// than waiting for the whole exchange.

export interface ChatDeltaEvent {
  sessionId: string;
  messageId: string;
  text: string;
}

/** Emitted twice per tool call: once at "start", once at "end". */
export interface ChatToolEvent {
  sessionId: string;
  messageId: string;
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  phase: "start" | "end";
  durationMs?: number | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

export interface ChatDoneEvent {
  sessionId: string;
  messageId: string;
  durationMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface ChatErrorEvent {
  sessionId: string;
  messageId: string;
  message: string;
}

/**
 * A conversation named from its first message. Arrives before the answer, so the
 * sidebar stops saying "New conversation" while the tools are still running.
 */
export interface ChatTitleEvent {
  sessionId: string;
  title: string;
}

export const CHAT_EVENTS = {
  delta: "chat:delta",
  tool: "chat:tool",
  done: "chat:done",
  error: "chat:error",
  title: "chat:title"
} as const;

