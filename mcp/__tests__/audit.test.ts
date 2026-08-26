import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditStore } from "../src/audit/index";
import type { AuditRecord } from "../src/audit/types";

function makeRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "entry-1",
    timestamp: "2026-08-26T08:00:00.000Z",
    status: "success",
    tool: "analyze_job_failure",
    args: { jobId: "job-abc", logType: "driver" },
    result: { summary: "OOM", evidence: { logSource: "s3" } },
    client: "claude-cli/2.0.22",
    durationMs: 1234,
    error: null,
    ...overrides,
  };
}

describe("audit store (bridge-backed)", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["MCP_BRIDGE_URL", "MCP_BRIDGE_TOKEN", "MCP_BRIDGE_INFO"]) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: true }), { status: 200 })));
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  it("posts the record to the bridge /write-audit-entry endpoint", async () => {
    process.env.MCP_BRIDGE_URL = "http://127.0.0.1:9999";
    process.env.MCP_BRIDGE_TOKEN = "tok-123";

    const store = createAuditStore();
    store.write(makeRecord());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:9999/write-audit-entry");
    expect((init.headers as Record<string, string>)["x-mcp-bridge-token"]).toBe("tok-123");
    const body = JSON.parse(init.body as string);
    expect(body.id).toBe("entry-1");
    expect(body.status).toBe("success");
    expect(body.tool).toBe("analyze_job_failure");
    expect(body.client).toBe("claude-cli/2.0.22");
    expect(body.durationMs).toBe(1234);
    expect(body.args).toEqual({ jobId: "job-abc", logType: "driver" });
    expect(body.result.summary).toBe("OOM");
  });

  it("falls back to the bridge-info file written by the desktop app", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-audit-test-"));
    const infoPath = join(dir, "mcp-bridge.json");
    writeFileSync(infoPath, JSON.stringify({ url: "http://127.0.0.1:8888/", token: "file-token" }));
    process.env.MCP_BRIDGE_INFO = infoPath;

    const store = createAuditStore();
    store.write(makeRecord({ id: "entry-2" }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:8888/write-audit-entry"); // trailing slash trimmed
    expect((init.headers as Record<string, string>)["x-mcp-bridge-token"]).toBe("file-token");
  });

  it("stays silent when no bridge config is available (never throws)", async () => {
    process.env.MCP_BRIDGE_INFO = join(tmpdir(), "does-not-exist", "mcp-bridge.json");

    const store = createAuditStore();
    expect(() => store.write(makeRecord({ id: "entry-3" }))).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
