import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAuditStore, createAuditEntry } from "../src/audit/index";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("audit store", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "mcp-audit-test-"));
    // Monkey-patch the audit dir by overriding process.env.HOME
    process.env.HOME = testDir;
  });

  afterAll(() => {
    // Restore original HOME
    delete process.env.HOME;
  });

  describe("createAuditStore", () => {
    it("should write and read an audit entry", async () => {
      const store = createAuditStore();

      const entry = createAuditEntry(
        "test_tool",
        { arg1: "value1" },
        100,
        null,
        { kind: "string", value: "hello" },
      );

      await store.write(entry, "raw log content here");

      const result = await store.get(entry.id);
      expect(result).not.toBeNull();
      expect(result!.tool).toBe("test_tool");
      expect(result!.args).toEqual({ arg1: "value1" });
      expect(result!.duration).toBe(100);
      expect(result!.rawText).toBe("raw log content here");
    });

    it("should return null for non-existent entry", async () => {
      const store = createAuditStore();
      const result = await store.get("non-existent-id");
      expect(result).toBeNull();
    });

    it("should write without raw text", async () => {
      const store = createAuditStore();

      const entry = createAuditEntry("list_accounts", {}, 10, null, { kind: "empty" });
      await store.write(entry);

      const result = await store.get(entry.id);
      expect(result).not.toBeNull();
      expect(result!.rawText).toBeUndefined();
    });

    it("should record errors", async () => {
      const store = createAuditStore();

      const entry = createAuditEntry("describe_job", { jobId: "j-123" }, 50, "Job not found", { kind: "empty" });
      await store.write(entry);

      const result = await store.get(entry.id);
      expect(result).not.toBeNull();
      expect(result!.error).toBe("Job not found");
    });
  });

  describe("createAuditEntry", () => {
    it("should generate a UUID", () => {
      const entry1 = createAuditEntry("t1", {}, 0, null, { kind: "empty" });
      const entry2 = createAuditEntry("t2", {}, 0, null, { kind: "empty" });

      expect(entry1.id).not.toBe(entry2.id);
      expect(entry1.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("should record the tool name and args", () => {
      const entry = createAuditEntry("get_simplified_logs", { jobId: "j-abc" }, 200, null, { kind: "string", value: "log preview" });

      expect(entry.tool).toBe("get_simplified_logs");
      expect(entry.args).toEqual({ jobId: "j-abc" });
      expect(entry.duration).toBe(200);
      expect(entry.resultPreview).toEqual({ kind: "string", value: "log preview" });
    });
  });
});