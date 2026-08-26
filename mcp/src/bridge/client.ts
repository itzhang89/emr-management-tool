type BridgeResponseBody<T> =
  | { data: T }
  | { error: string };

interface EnvConfig {
  bridgeUrl: string;
  bridgeToken: string;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

function appDataDir(): string {
  if (process.platform === "darwin") {
    return join(process.env.HOME || "/tmp", "Library", "Application Support", "emr-management-tool");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || "/tmp", "emr-management-tool");
  }
  return join(
    process.env.XDG_DATA_HOME || join(process.env.HOME || "/tmp", ".local", "share"),
    "emr-management-tool",
  );
}

// stdio clients are spawned by the agent (Claude Code, Cursor, …), not by the
// desktop app, so they can't inherit MCP_BRIDGE_URL/TOKEN via env. The app
// writes them to a bridge-info file while it's running; fall back to that.
function readBridgeInfoFile(): Partial<EnvConfig> {
  const path = process.env.MCP_BRIDGE_INFO || join(appDataDir(), "mcp-bridge.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { url?: string; token?: string };
    return { bridgeUrl: parsed.url, bridgeToken: parsed.token };
  } catch {
    return {};
  }
}

function readEnv(): EnvConfig {
  const fromFile = readBridgeInfoFile();
  const bridgeUrl = process.env.MCP_BRIDGE_URL || fromFile.bridgeUrl;
  const bridgeToken = process.env.MCP_BRIDGE_TOKEN || fromFile.bridgeToken;

  if (!bridgeUrl) {
    throw new Error(
      "Bridge URL not found. Start the MCP server from the EMR desktop app (it writes mcp-bridge.json), or set MCP_BRIDGE_URL.",
    );
  }
  if (!bridgeToken) {
    throw new Error(
      "Bridge token not found. Start the MCP server from the EMR desktop app, or set MCP_BRIDGE_TOKEN.",
    );
  }

  return { bridgeUrl: bridgeUrl.replace(/\/$/, ""), bridgeToken };
}

function baseHeaders(env: EnvConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-mcp-bridge-token": env.bridgeToken,
  };
}

async function bridgeFetch<T>(
  env: EnvConfig,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${env.bridgeUrl}${path}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: baseHeaders(env),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Bridge ${path} returned ${res.status}: ${errText}`);
  }

  const raw = (await res.json()) as BridgeResponseBody<T>;
  if ("error" in raw) {
    throw new Error(`Bridge ${path}: ${raw.error}`);
  }
  return raw.data;
}

// ---- Response types. The Rust bridge serializes with
// `#[serde(rename_all = "camelCase")]`, so responses are camelCase even though
// request bodies are snake_case (the request structs have no rename attr). ----

export interface BridgeAccount {
  id: string;
  name: string;
  region: string;
  isActive: boolean;
  username: string;
}

export interface BridgeJobDescribeDetails {
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
}

export interface BridgeJobSummary {
  id: string;
  name: string;
  state: string;
  accountId?: string;
  region?: string;
  virtualClusterId: string;
  virtualClusterName?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
  describeDetails?: BridgeJobDescribeDetails;
}

export interface BridgeLogStream {
  id: string;
  label: string;
  cloudWatchStreamName: string;
  lastEventTimestamp?: string;
}

export interface BridgeLogStreamsResponse {
  jobId: string;
  streams: BridgeLogStream[];
  nextToken?: string;
}

export interface BridgeLogEntry {
  timestamp: string;
  level: string;
  message: string;
  streamName: string;
}

export interface BridgeLogsResponse {
  jobId: string;
  entries: BridgeLogEntry[];
  nextForwardToken?: string;
}

export interface BridgeS3Object {
  id: string;
  label: string;
  stream: string;
  s3Key: string;
  size: number;
  lastModified?: string;
}

export interface BridgeS3ObjectsResponse {
  bucket: string;
  objects: BridgeS3Object[];
  nextToken?: string;
}

export interface BridgeS3ObjectContent {
  bucket: string;
  key: string;
  content: string;
  etag?: string;
  contentType?: string;
  lastModified?: string;
}

export interface BridgeClient {
  listAccounts(): Promise<BridgeAccount[]>;
  describeJob(req: {
    accountId?: string;
    jobId: string;
    virtualClusterId?: string;
  }): Promise<BridgeJobSummary>;
  listLogStreams(req: {
    accountId?: string;
    jobId: string;
    logGroupName: string;
    streamNamePrefix: string;
    nextToken?: string;
  }): Promise<BridgeLogStreamsResponse>;
  getLogs(req: {
    accountId?: string;
    jobId: string;
    logGroupName?: string;
    streamNamePrefix?: string;
    logStreamName?: string;
    filterPattern?: string;
    limit?: number;
    nextForwardToken?: string;
  }): Promise<BridgeLogsResponse>;
  listS3Objects(req: {
    accountId?: string;
    bucket: string;
    prefix: string;
    continuationToken?: string;
  }): Promise<BridgeS3ObjectsResponse>;
  getS3Object(req: {
    accountId?: string;
    bucket: string;
    key: string;
  }): Promise<BridgeS3ObjectContent>;
}

export function createBridgeClient(): BridgeClient {
  const env = readEnv();

  return {
    listAccounts: async () =>
      bridgeFetch<BridgeAccount[]>(env, "/list-accounts"),

    describeJob: async (req) =>
      bridgeFetch<BridgeJobSummary>(env, "/describe-job", {
        account_id: req.accountId,
        job_id: req.jobId,
        virtual_cluster_id: req.virtualClusterId,
      }),

    listLogStreams: async (req) =>
      bridgeFetch<BridgeLogStreamsResponse>(env, "/list-log-streams", {
        account_id: req.accountId,
        job_id: req.jobId,
        log_group_name: req.logGroupName,
        stream_name_prefix: req.streamNamePrefix,
        next_token: req.nextToken,
      }),

    getLogs: async (req) =>
      bridgeFetch<BridgeLogsResponse>(env, "/get-logs", {
        account_id: req.accountId,
        job_id: req.jobId,
        log_group_name: req.logGroupName,
        stream_name_prefix: req.streamNamePrefix,
        log_stream_name: req.logStreamName,
        filter_pattern: req.filterPattern,
        limit: req.limit,
        next_forward_token: req.nextForwardToken,
      }),

    listS3Objects: async (req) =>
      bridgeFetch<BridgeS3ObjectsResponse>(env, "/list-s3-objects", {
        account_id: req.accountId,
        bucket: req.bucket,
        prefix: req.prefix,
        continuation_token: req.continuationToken,
      }),

    getS3Object: async (req) =>
      bridgeFetch<BridgeS3ObjectContent>(env, "/get-s3-object", {
        account_id: req.accountId,
        bucket: req.bucket,
        key: req.key,
      }),
  };
}