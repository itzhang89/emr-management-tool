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
  /** Structured diagnostics for a failed request (e.g. an LLM call), if any. */
  details?: ChatErrorDetails;
}

/**
 * Structured diagnostics for a failed model request, shown behind the "details"
 * disclosure on an errored reply. Fields present depend on where it failed: a
 * transport failure has no HTTP status; a resolve (config) failure no request at
 * all. Bodies are truncated on the backend; the UI truncates defensively too.
 */
export interface ChatErrorDetails {
  url?: string;
  /** HTTP method, e.g. "POST". */
  method?: string;
  httpStatus?: number;
  /** The JSON body that was sent (never contains an API key — keys are headers). */
  requestBody?: unknown;
  /** What the provider returned. */
  responseBody?: string;
  /** The provider's own reported reason, when it gave one. */
  providerReason?: string;
  errorCode?: string;
  /** "http" | "stream" | "transport" | "resolve" */
  errorKind?: string;
  /** The innermost cause chain for transport/resolve failures. */
  stack?: string;
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
  /** Provider that drove the call — only in-process Chat calls carry one. */
  providerId?: string | null;
  /** The API model id (e.g. "claude-opus-4-8") used for the Chat call. */
  modelId?: string | null;
}

// --- LLM provider configuration -------------------------------------------
// Two levels: provider → model. A provider is one place to send requests —
// protocol, address, API keys, custom headers — and its models hang directly off
// it. There is no endpoint level: a second address means a second provider, and
// duplicating one makes that cheap.
//
// Secrets are never part of these types. An API key reports a masked value that
// can be replaced but not read back, and custom headers report only their names.

/**
 * Which request/response shape a provider speaks — not a vendor name. An
 * OpenAI-compatible gateway is "openai" no matter who runs it.
 */
export type LlmProtocol = "openai" | "anthropic" | "gemini";

/** Only "chat" participates in Chat's model picker. */
export type LlmModelType = "chat" | "image" | "embed";

/**
 * What a model can do. Recorded and displayed, but not yet used to shape
 * outgoing requests — the values come from user input or a gateway's guess, and
 * trimming a request by them would turn one mis-set checkbox into "the model
 * suddenly cannot call tools".
 */
export interface LlmModelCapabilities {
  reasoning: boolean;
  toolCalling: boolean;
  text: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
}

export interface LlmModel {
  id: string;
  providerId: string;
  /** The value sent to the API, e.g. "claude-opus-4-8". */
  modelId: string;
  /** Grouping label in the model tree, shown as "group" in the UI. */
  series: string;
  displayName?: string | null;
  modelType: LlmModelType;
  capabilities: LlmModelCapabilities;
  isDefault: boolean;
  contextWindow?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  createdAt: string;
}

/**
 * Whether a stored API key is usable. "unknown" means nothing has probed it yet
 * — distinct from "unhealthy", which means something tried and was refused.
 */
export type LlmApiKeyStatus = "unknown" | "healthy" | "unhealthy";

export interface LlmApiKey {
  id: string;
  providerId: string;
  label?: string | null;
  /** e.g. "sk-••••abcd". Display only — the real key stays in the keychain. */
  masked: string;
  status: LlmApiKeyStatus;
  /** Why a probe failed, when it did. */
  statusMessage?: string | null;
  checkedAt?: string | null;
  sortOrder: number;
  createdAt: string;
}

/**
 * One place to send requests: a protocol, an address, the keys that open it, and
 * the models it offers.
 */
export interface LlmProvider {
  id: string;
  name: string;
  protocol: LlmProtocol;
  /** Empty until filled in. A provider with no address cannot be enabled. */
  baseUrl: string;
  enabled: boolean;
  /** True for a seeded preset the user has not replaced. */
  builtIn: boolean;
  /** Names of the configured custom headers; the values stay in the keychain. */
  headerNames: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  apiKeys: LlmApiKey[];
  models: LlmModel[];
}

export interface CreateLlmProviderRequest {
  name: string;
  protocol?: LlmProtocol;
}

export interface UpdateLlmProviderRequest {
  id: string;
  name?: string;
  protocol?: LlmProtocol;
  baseUrl?: string;
  enabled?: boolean;
  sortOrder?: number;
}

/** Copies settings and models under a new name — never the API keys. */
export interface DuplicateLlmProviderRequest {
  id: string;
  name: string;
}

/** Omit `value` to keep the stored one — the UI cannot read it back. */
export interface LlmHeaderInput {
  name: string;
  value?: string;
}

/** Submitted as a unit: names absent from the list are removed. */
export interface SetLlmProviderHeadersRequest {
  providerId: string;
  headers: LlmHeaderInput[];
}

export interface AddLlmApiKeyRequest {
  providerId: string;
  value: string;
  label?: string;
}

export interface UpdateLlmApiKeyRequest {
  id: string;
  label?: string;
  sortOrder?: number;
}

export interface LlmProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  modelCount?: number | null;
}

/** A model the provider advertises, before the user chooses to import it. */
export interface LlmModelCandidate {
  modelId: string;
  series: string;
  displayName?: string | null;
  /** Reported by Gemini's listing; null for the shapes that do not report them. */
  contextWindow?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  alreadyAdded: boolean;
}

export interface AddLlmModelInput {
  modelId: string;
  series?: string;
  displayName?: string;
  modelType?: LlmModelType;
  capabilities?: LlmModelCapabilities;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface AddLlmModelsRequest {
  providerId: string;
  models: AddLlmModelInput[];
}

export interface UpdateLlmModelRequest {
  id: string;
  modelId?: string;
  series?: string;
  displayName?: string;
  modelType?: LlmModelType;
  capabilities?: LlmModelCapabilities;
  isDefault?: boolean;
  contextWindow?: number;
  maxInputTokens?: number;
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
  /**
   * Opaque provider token the backend echoes back on the next request — Gemini
   * rejects a follow-up whose function calls arrive without it. Present here only
   * because it is on the wire; nothing in the UI reads it.
   */
  signature?: string | null;
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
  /** Structured diagnostics behind the error line, when the backend captured them. */
  errorDetails?: ChatErrorDetails | null;
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
  /** Structured diagnostics for the failed call, when the backend captured them. */
  details?: ChatErrorDetails | null;
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

