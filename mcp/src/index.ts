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
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createBridgeClient } from "./bridge/client.js";
import { createAuditStore } from "./audit/index.js";
import type { BridgeClient } from "./bridge/client.js";
import { buildAnalyzeJobFailureTool, AnalyzeJobFailureArgs } from "./tools/analyzeJobFailure.js";

const DEFAULT_PORT = 5175;
const MAX_PORT_ATTEMPTS = 20;
const STREAMABLE_HTTP_PATH = "/mcp";

function parseArgs() {
  const port = process.env.MCP_PORT
    ? parseInt(process.env.MCP_PORT, 10)
    : DEFAULT_PORT;
  return {
    port: isNaN(port) ? DEFAULT_PORT : port,
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

// --- Client identification for the audit log -------------------------------
// The MCP initialize request carries clientInfo { name, version }. We record
// the most recently seen client and attribute tool calls to it (stateless HTTP
// transport: calls always follow an initialize from the same client).

let latestClientInfo: { name: string; version?: string } | undefined;

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
    "Analyze an EMR on EKS job failure by id. Only jobId is required — the job is located automatically across the configured accounts (active account first, then others), so no virtual cluster or account must be supplied. Returns job state and concise error evidence for the AI to judge.",
    {
      jobId: z.string().describe("EMR job run ID"),
      virtualClusterId: z.string().optional().describe("EMR virtual cluster ID (optional — auto-resolved if omitted)"),
      accountId: z.string().optional().describe("Account ID (optional — defaults to active account, then other accounts)"),
      logType: z.enum(["driver", "executor", "controller"]).optional().default("driver").describe("Log type to analyze"),
      stream: z.string().optional().default("stderr").describe("Stream name filter (default: stderr)"),
    },
    async (args) => {
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
          result = parsed;
        } catch {
          result = { raw: text.slice(0, 2000) };
        }
        return toolResult;
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        auditStore.write({
          id: crypto.randomUUID(),
          timestamp: startedAt,
          status: error ? "error" : "success",
          tool: "analyze_job_failure",
          args: args as unknown as Record<string, unknown>,
          result,
          client: latestClientInfo?.name ?? "unknown",
          durationMs: Date.now() - start,
          error,
        });
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

  const resolvedPort = await findFreePort(config.port);

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
        res.end(JSON.stringify({ status: "ok", port: resolvedPort }));
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
    console.log(`EMR Job Log Analysis MCP Server`);
    console.log(`   Transport: streamableHttp`);
    console.log(`   Endpoint:  http://localhost:${resolvedPort}${STREAMABLE_HTTP_PATH}`);
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
