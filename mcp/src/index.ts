/**
 * EMR Job Log Analysis MCP Server
 *
 * Entry point: creates the MCP server, registers the single
 * `analyze_job_failure` tool, and listens on the Streamable HTTP transport.
 *
 * All AWS operations go through the in-process Rust bridge (mcp_bridge) via
 * HTTP — credentials never leave the Rust process.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createBridgeClient } from "./bridge/client.js";
import { createAuditStore } from "./audit/index.js";
import { resolveClientName, type ClientInfo } from "./audit/client.js";
import type { BridgeClient } from "./bridge/client.js";
import { buildAnalyzeJobFailureTool, AnalyzeJobFailureArgs } from "./tools/analyzeJobFailure.js";

const DEFAULT_PORT = 5175;
const STREAMABLE_HTTP_PATH = "/mcp";

function parseArgs() {
  const port = process.env.MCP_PORT
    ? parseInt(process.env.MCP_PORT, 10)
    : DEFAULT_PORT;
  return {
    port: isNaN(port) ? DEFAULT_PORT : port,
  };
}

// --- Client identification for the audit log -------------------------------
// See ./audit/client.ts: the stateless HTTP transport rebuilds the server per
// request, so the caller is identified from the request headers, falling back
// to the clientInfo of the most recent initialize on this process.

let latestClientInfo: ClientInfo | undefined;

function registerTools(bridge: BridgeClient, auditStore: ReturnType<typeof createAuditStore>) {
  const server = new McpServer({
    name: "emr-job-log-analysis",
    version: "1.0.0",
    description: "EMR on EKS job failure analysis — given an EMR job id, locate the job across configured accounts and return concise, sanitized error evidence for root-cause analysis.",
  });

  // The single tool: analyze_job_failure
  const analyzeJobFailureHandler = buildAnalyzeJobFailureTool(bridge);
  server.tool(
    "analyze_job_failure",
    "Analyze an EMR on EKS job failure by id. Only jobId is required — the job is located automatically across the configured accounts (active account first, then others), so no virtual cluster or account must be supplied. Returns the job state, pod-level controller evidence (checked first — image pull failures, OOMKills and rejected service accounts never reach the Spark driver log), and the Spark application error evidence. If the jobId is malformed the tool returns error \"invalidJobId\" without searching: ask the user for the complete id rather than guessing.",
    {
      jobId: z
        .string()
        .describe(
          'Complete EMR job run ID — a lowercase alphanumeric id of 16-64 chars (e.g. "0000000381t77o3g8f5"), optionally "spark-" prefixed. Never truncate or invent it.',
        ),
      virtualClusterId: z.string().optional().describe("EMR virtual cluster ID (optional — auto-resolved if omitted)"),
      accountId: z.string().optional().describe("Account ID (optional — defaults to active account, then other accounts)"),
      logType: z.enum(["driver", "executor", "controller"]).optional().default("driver").describe("Log type to analyze"),
      stream: z.string().optional().default("stderr").describe("Stream name filter (default: stderr)"),
    },
    async (args, extra) => {
      const start = Date.now();
      const startedAt = new Date(start).toISOString();
      let error: string | null = null;
      let result: Record<string, unknown> = {};
      try {
        const toolResult = await analyzeJobFailureHandler(args as unknown as AnalyzeJobFailureArgs);
        const text = (toolResult.content[0] as { text?: string } | undefined)?.text || "{}";
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const evidence = (parsed.evidence ?? {}) as Record<string, unknown>;
          // The full raw logs would bloat the audit row; the structured
          // evidence fields (errorTail, tracebacks, causes, …) are kept.
          delete evidence.rawLogs;
          parsed.evidence = evidence;
          const controllerEvidence = (parsed.controllerEvidence ?? {}) as Record<string, unknown>;
          delete controllerEvidence.rawLogs;
          parsed.controllerEvidence = controllerEvidence;
          result = parsed;
        } catch {
          result = { raw: text.slice(0, 2000) };
        }
        return toolResult;
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        // Auditing must never break the tool call, so swallow anything here.
        try {
          auditStore.write({
            id: randomUUID(),
            timestamp: startedAt,
            status: error ? "error" : "success",
            tool: "analyze_job_failure",
            args: args as unknown as Record<string, unknown>,
            result,
            client: resolveClientName(extra, latestClientInfo),
            durationMs: Date.now() - start,
            error,
          });
        } catch (auditError) {
          console.error("Audit write failed:", auditError);
        }
      }
    },
  );

  return server;
}

function buildServer(bridge: BridgeClient, auditStore: ReturnType<typeof createAuditStore>) {
  const server = registerTools(bridge, auditStore);
  const lowLevel = (server as unknown as { server?: Server }).server;
  if (lowLevel) {
    lowLevel.oninitialized = () => {
      const clientInfo = lowLevel.getClientVersion();
      if (clientInfo) {
        latestClientInfo = { name: clientInfo.name, version: clientInfo.version };
      }
    };
  }
  return server;
}

async function main() {
  const config = parseArgs();

  const bridge = createBridgeClient() as BridgeClient;
  const auditStore = createAuditStore();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    try {
      if (url.pathname === STREAMABLE_HTTP_PATH) {
        // Stateless mode: a transport cannot be reused across requests, so build
        // a fresh server + transport per request and tear them down on close.
        const server = buildServer(bridge, auditStore);
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
        res.end(JSON.stringify({ status: "ok", port: config.port }));
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

  // Bind exactly the requested port. Auto-bumping to a nearby free port would
  // make the app's "MCP Port" field and the agent config it generates point at
  // the wrong endpoint, so a busy port is a hard failure instead — the desktop
  // app clears stale listeners before spawning us.
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${config.port} is already in use. Stop whatever is listening on it and start the MCP server again.`,
      );
    } else {
      console.error("HTTP server error:", err);
    }
    process.exit(1);
  });

  httpServer.listen(config.port, "127.0.0.1", () => {
    console.log(`EMR Job Log Analysis MCP Server`);
    console.log(`   Transport: streamableHttp`);
    console.log(`   Endpoint:  http://localhost:${config.port}${STREAMABLE_HTTP_PATH}`);
    console.log(`   Health:    http://localhost:${config.port}/health`);
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
