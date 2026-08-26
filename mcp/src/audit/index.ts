import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditRecord, AuditStore } from "./types.js";

/**
 * Audit storage for the Node MCP server.
 *
 * All writes go through the Rust bridge (`POST /write-audit-entry`) so the
 * data lands in the app's own SQLite database — the single source the desktop
 * Audit Log tab reads from. The Node process never touches the database
 * directly; audit writes are fire-and-forget (a failed write must never break
 * the tool call itself).
 */

const BRIDGE_INFO_PATH_ENV = "MCP_BRIDGE_INFO";

interface BridgeConfig {
  url: string;
  token: string;
}

function appDataDir(): string {
  // Same convention as the Rust app's dirs crate.
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

function readBridgeConfig(): BridgeConfig {
  if (process.env.MCP_BRIDGE_URL && process.env.MCP_BRIDGE_TOKEN) {
    return {
      url: process.env.MCP_BRIDGE_URL.replace(/\/$/, ""),
      token: process.env.MCP_BRIDGE_TOKEN,
    };
  }
  // The desktop app publishes URL + token here while it's running.
  const path = process.env[BRIDGE_INFO_PATH_ENV] || join(appDataDir(), "mcp-bridge.json");
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as { url?: string; token?: string };
  if (!parsed.url || !parsed.token) {
    throw new Error("Bridge info file is missing url or token");
  }
  return { url: parsed.url.replace(/\/$/, ""), token: parsed.token };
}

export function createAuditStore(): AuditStore {
  let config: BridgeConfig | undefined;
  let configError = false;

  function resolveConfig(): BridgeConfig | undefined {
    if (configError) return config;
    if (!config) {
      try {
        config = readBridgeConfig();
      } catch (err) {
        configError = true;
        console.error("Audit store: bridge config unavailable:", err);
      }
    }
    return config;
  }

  return {
    write(record: AuditRecord): void {
      const bridge = resolveConfig();
      if (!bridge) return;
      // Fire-and-forget: never block or throw on audit persistence.
      void fetch(`${bridge.url}/write-audit-entry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-bridge-token": bridge.token,
        },
        body: JSON.stringify(record),
      }).catch((err) => {
        console.error("Audit write failed:", err);
      });
    },
  };
}
