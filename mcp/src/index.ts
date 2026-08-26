/**
 * EMR Job Log Analysis MCP Server
 *
 * Entry point: creates the MCP server, registers all tools, and starts
 * listening on the configured transport.
 *
 * All AWS operations go through the in-process Rust bridge (mcp_bridge)
 * via HTTP — credentials never leave the Rust process.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createBridgeClient } from "./bridge/client.js";
import { createAuditStore, createAuditEntry } from "./audit/index.js";
import type { BridgeClient } from "./bridge/client.js";
import { buildListAccountsTool } from "./tools/listAccounts.js";
import { buildDescribeJobTool, DescribeJobArgs } from "./tools/describeJob.js";
import { buildListJobLogsTool, ListJobLogsArgs } from "./tools/listJobLogs.js";
import { buildGetSimplifiedLogsTool, GetSimplifiedLogsArgs } from "./tools/getSimplifiedLogs.js";
import { buildAnalyzeJobFailureTool, AnalyzeJobFailureArgs } from "./tools/analyzeJobFailure.js";
import { buildSearchLogsTool, SearchLogsArgs } from "./tools/searchLogs.js";
import { buildGetAuditEntryTool, GetAuditEntryArgs } from "./tools/getAuditEntry.js";

const DEFAULT_PORT = 5175;
const MAX_PORT_ATTEMPTS = 20;
const SSE_PATH = "/sse";
const MESSAGE_PATH = "/message";
const STREAMABLE_HTTP_PATH = "/mcp";

function parseArgs() {
  const port = process.env.MCP_PORT
    ? parseInt(process.env.MCP_PORT, 10)
    : DEFAULT_PORT;
  const rawTransport = process.env.MCP_TRANSPORT;
  const transport =
    rawTransport === "sse" ? "sse" : rawTransport === "stdio" ? "stdio" : "streamableHttp";
  return {
    port: isNaN(port) ? DEFAULT_PORT : port,
    transport,
  };
}

async function findFreePort(startPort: number): Promise<number> {
  const net = await import("node:net");
  for (let port = startPort; port < startPort + MAX_PORT_ATTEMPTS; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.on("error", () => {
        server.close();
        resolve(false);
      });
      server.listen(port, "127.0.0.1", () => {
        server.close();
        resolve(true);
      });
    });
    if (available) return port;
  }
  throw new Error(
    `Could not find a free port in range ${startPort}-${startPort + MAX_PORT_ATTEMPTS - 1}`,
  );
}

function registerTools(bridge: BridgeClient, auditStore: ReturnType<typeof createAuditStore>) {
  const server = new McpServer({
    name: "emr-job-log-analysis",
    version: "1.0.0",
    description: "EMR on EKS job log analysis — simplified logs, failure root cause analysis, and log search.",
  });

  // 1. list_accounts
  const listAccountsHandler = buildListAccountsTool(bridge);
  server.tool(
    "list_accounts",
    "List AWS accounts configured in the desktop app. Only usernames shown — no credentials.",
    {},
    async () => {
      const start = Date.now();
      let error: string | null = null;
      try {
        return await listAccountsHandler();
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        await auditStore.write(createAuditEntry("list_accounts", {}, Date.now() - start, error, {
          sizeChars: 0,
          sanitized: false,
        }));
      }
    },
  );

  // 2. describe_job
  const describeJobHandler = buildDescribeJobTool(bridge);
  server.tool(
    "describe_job",
    "Describe an EMR on EKS job run. Returns state, error details, and monitoring configuration. Only jobId is required — the virtual cluster is resolved automatically from the app's job history.",
    {
      jobId: z.string().describe("EMR job run ID"),
      virtualClusterId: z.string().optional().describe("EMR virtual cluster ID (optional — auto-resolved from job history if omitted)"),
      accountId: z.string().optional().describe("Account ID (defaults to active account)"),
    },
    async (args) => {
      const start = Date.now();
      let error: string | null = null;
      try {
        return await describeJobHandler(args as unknown as DescribeJobArgs);
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        await auditStore.write(createAuditEntry("describe_job", args as unknown as Record<string, unknown>, Date.now() - start, error, {
          sizeChars: 0,
          sanitized: false,
        }));
      }
    },
  );

  // 3. list_job_logs
  const listJobLogsHandler = buildListJobLogsTool(bridge);
  server.tool(
    "list_job_logs",
    "List log streams for a job, organized by type (driver/executor/controller).",
    {
      jobId: z.string().describe("EMR job run ID"),
      virtualClusterId: z.string().optional().describe("EMR virtual cluster ID (optional)"),
      accountId: z.string().optional().describe("Account ID (defaults to active account)"),
      logType: z.enum(["driver", "executor", "controller"]).optional().describe("Filter by log type"),
      limit: z.number().int().positive().optional().describe("Maximum streams to return"),
      nextToken: z.string().optional().describe("Pagination token"),
    },
    async (args) => {
      const start = Date.now();
      let error: string | null = null;
      try {
        return await listJobLogsHandler(args as unknown as ListJobLogsArgs);
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        await auditStore.write(createAuditEntry("list_job_logs", args as unknown as Record<string, unknown>, Date.now() - start, error, {
          sizeChars: 0,
          sanitized: false,
        }));
      }
    },
  );

  // 4. get_simplified_logs
  const getSimplifiedLogsHandler = buildGetSimplifiedLogsTool(bridge);
  server.tool(
    "get_simplified_logs",
    "Get simplified job logs — noise-filtered, sanitized, ready for analysis. S3 preferred, falls back to CloudWatch.",
    {
      jobId: z.string().describe("EMR job run ID"),
      virtualClusterId: z.string().optional().describe("EMR virtual cluster ID (optional — auto-resolved)"),
      accountId: z.string().optional().describe("Account ID (defaults to active account)"),
      logType: z.enum(["driver", "executor", "controller"]).optional().default("driver").describe("Log type to fetch"),
      stream: z.string().optional().default("stderr").describe("Stream name filter (default: stderr)"),
      maxChars: z.number().int().positive().optional().default(512_000).describe("Maximum characters to return"),
      includeNoise: z.boolean().optional().default(false).describe("Include Spark INFO noise loggers"),
    },
    async (args) => {
      const start = Date.now();
      let error: string | null = null;
      let resultSize = 0;
      try {
        const result = await getSimplifiedLogsHandler(args as unknown as GetSimplifiedLogsArgs);
        resultSize = result.content[0]?.text.length || 0;
        return result;
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        await auditStore.write(createAuditEntry("get_simplified_logs", args as unknown as Record<string, unknown>, Date.now() - start, error, {
          sizeChars: resultSize,
          sanitized: true,
        }));
      }
    },
  );

  // 5. analyze_job_failure
  const analyzeJobFailureHandler = buildAnalyzeJobFailureTool(bridge);
  server.tool(
    "analyze_job_failure",
    "Analyze job failure root cause. Returns job state, error evidence, and heuristic candidate causes. No LLM involved — pure deterministic analysis. Only jobId is required.",
    {
      jobId: z.string().describe("EMR job run ID"),
      virtualClusterId: z.string().optional().describe("EMR virtual cluster ID (optional — auto-resolved from job history)"),
      accountId: z.string().optional().describe("Account ID (defaults to active account)"),
      logType: z.enum(["driver", "executor", "controller"]).optional().default("driver").describe("Log type to analyze"),
      stream: z.string().optional().default("stderr").describe("Stream name filter (default: stderr)"),
    },
    async (args) => {
      const start = Date.now();
      let error: string | null = null;
      let candidateCauses: string[] = [];
      try {
        const result = await analyzeJobFailureHandler(args as unknown as AnalyzeJobFailureArgs);
        const parsed = JSON.parse(result.content[0]?.text || "{}");
        candidateCauses = (parsed.candidateCauses || []).map((c: { cause: string }) => c.cause);
        return result;
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        await auditStore.write(createAuditEntry("analyze_job_failure", args as unknown as Record<string, unknown>, Date.now() - start, error, {
          sizeChars: 0,
          sanitized: true,
          candidateCauses,
        }));
      }
    },
  );

  // 6. search_logs
  const searchLogsHandler = buildSearchLogsTool(bridge);
  server.tool(
    "search_logs",
    "Search job logs by keyword. Uses CloudWatch filterPattern, with client-side fallback for broader matching.",
    {
      jobId: z.string().describe("EMR job run ID"),
      virtualClusterId: z.string().optional().describe("EMR virtual cluster ID (optional — auto-resolved)"),
      accountId: z.string().optional().describe("Account ID (defaults to active account)"),
      query: z.string().describe("Search keyword or phrase"),
      logType: z.enum(["driver", "executor", "controller"]).optional().describe("Filter by log type"),
      limit: z.number().int().positive().optional().default(100).describe("Maximum matching entries"),
    },
    async (args) => {
      const start = Date.now();
      let error: string | null = null;
      try {
        return await searchLogsHandler(args as unknown as SearchLogsArgs);
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        await auditStore.write(createAuditEntry("search_logs", args as unknown as Record<string, unknown>, Date.now() - start, error, {
          sizeChars: 0,
          sanitized: true,
        }));
      }
    },
  );

  // 7. get_audit_entry (developer tool)
  const getAuditEntryHandler = buildGetAuditEntryTool(auditStore);
  server.tool(
    "get_audit_entry",
    "[Developer] Retrieve a full audit trail entry for a previous tool invocation. Optionally include the raw (unsanitized) log text.",
    {
      entryId: z.string().describe("Audit entry UUID"),
      includeRawText: z.boolean().optional().default(false).describe("Include the raw (unsanitized) log text"),
    },
    async (args) => {
      const start = Date.now();
      let error: string | null = null;
      try {
        return await getAuditEntryHandler(args as unknown as GetAuditEntryArgs);
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        await auditStore.write(createAuditEntry("get_audit_entry", args as unknown as Record<string, unknown>, Date.now() - start, error, {
          sizeChars: 0,
          sanitized: false,
        }));
      }
    },
  );

  return server;
}

async function main() {
  const config = parseArgs();

  const bridge = createBridgeClient() as BridgeClient;
  const auditStore = createAuditStore();
  const buildServer = () => registerTools(bridge, auditStore);

  // stdio: no HTTP server. Connect one long-lived server to the process's
  // stdin/stdout. Logging must go to stderr so it never corrupts the protocol.
  if (config.transport === "stdio") {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("EMR Job Log Analysis MCP Server (stdio transport) ready");
    const shutdown = () => {
      server.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const resolvedPort = await findFreePort(config.port);

  // SSE keeps one long-lived server/transport per client session so that POSTs
  // to MESSAGE_PATH route back to the stream that opened the session.
  const sseTransports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    try {
      if (url.pathname === SSE_PATH) {
        const transport = new SSEServerTransport(MESSAGE_PATH, res);
        sseTransports.set(transport.sessionId, transport);
        res.on("close", () => sseTransports.delete(transport.sessionId));
        await buildServer().connect(transport);
        return;
      }

      if (url.pathname === MESSAGE_PATH) {
        const sessionId = url.searchParams.get("sessionId");
        const transport = sessionId ? sseTransports.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown or expired SSE session" }));
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }

      if (url.pathname === STREAMABLE_HTTP_PATH) {
        // Stateless mode: a transport cannot be reused across requests, so build
        // a fresh server + transport per request and tear them down on close.
        const server = buildServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        res.on("close", () => {
          transport.close();
          server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", port: resolvedPort, transport: config.transport }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (err) {
      console.error("Request error:", err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal server error");
      }
    }
  });

  httpServer.listen(resolvedPort, "127.0.0.1", () => {
    const activePath = config.transport === "sse" ? SSE_PATH : STREAMABLE_HTTP_PATH;
    const endpoint = `http://localhost:${resolvedPort}${activePath}`;
    console.log(`EMR Job Log Analysis MCP Server`);
    console.log(`   Transport: ${config.transport}`);
    console.log(`   Endpoint:  ${endpoint}`);
    console.log(`   Health:    http://localhost:${resolvedPort}/health`);
  });

  const shutdown = () => {
    console.log("Shutting down...");
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});