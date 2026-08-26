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
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createBridgeClient } from "./bridge/client.js";
import { createAuditStore, createAuditEntry } from "./audit/index.js";
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
      let error: string | null = null;
      let candidateCauses: string[] = [];
      let sizeChars = 0;
      try {
        const result = await analyzeJobFailureHandler(args as unknown as AnalyzeJobFailureArgs);
        sizeChars = (result.content[0] as { text?: string } | undefined)?.text?.length || 0;
        const parsed = JSON.parse(sizeChars ? (result.content[0] as { text: string }).text : "{}");
        candidateCauses = (parsed.evidence?.candidateCauses || []).map((c: { cause: string }) => c.cause);
        return result;
      } catch (e) {
        error = String(e);
        throw e;
      } finally {
        await auditStore.write(createAuditEntry("analyze_job_failure", args as unknown as Record<string, unknown>, Date.now() - start, error, {
          sizeChars,
          sanitized: true,
          candidateCauses,
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

  const resolvedPort = await findFreePort(config.port);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    try {
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
