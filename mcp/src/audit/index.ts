import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { AuditEntry, AuditEntryWithRaw, AuditStore } from "./types.js";

const AUDIT_RETENTION_DAYS = 30;
const RAW_DIR = "raw";

function appDataDir(): string {
  // Platform-appropriate data directory
  // Same convention as the Rust app's dirs crate
  if (process.platform === "darwin") {
    return join(process.env.HOME || "/tmp", "Library", "Application Support", "emr-management-tool");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || "/tmp", "emr-management-tool");
  }
  return join(process.env.XDG_DATA_HOME || join(process.env.HOME || "/tmp", ".local", "share"), "emr-management-tool");
}

function auditDir(): string {
  return process.env.MCP_AUDIT_DIR || join(appDataDir(), "mcp-audit");
}

function dailyFilePath(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return join(auditDir(), `mcp-audit-${y}-${m}-${d}.jsonl`);
}

export function createAuditStore(): AuditStore {
  let ready: Promise<void> | null = null;

  async function ensureDir(): Promise<void> {
    if (ready) return ready;
    ready = (async () => {
      await mkdir(auditDir(), { recursive: true });
      await mkdir(join(auditDir(), RAW_DIR), { recursive: true });
      await pruneOldFiles();
    })();
    return ready;
  }

  async function pruneOldFiles(): Promise<void> {
    try {
      const files = await readdir(auditDir());
      const cutoff = Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const prunePromises = files
        .filter((f) => f.startsWith("mcp-audit-") && f.endsWith(".jsonl"))
        .map(async (f) => {
          const match = f.match(/mcp-audit-(\d{4})-(\d{2})-(\d{2})\.jsonl/);
          if (match) {
            const [_, y, m, d] = match;
            const fileDate = new Date(`${y}-${m}-${d}T00:00:00Z`).getTime();
            if (fileDate < cutoff) {
              await unlink(join(auditDir(), f)).catch(() => {});
            }
          }
        });
      await Promise.all(prunePromises);
    } catch {
      // directory may not exist yet
    }
  }

  return {
    async write(entry: AuditEntry, rawText?: string): Promise<void> {
      await ensureDir();
      const filePath = dailyFilePath(new Date());
      const line = JSON.stringify(entry) + "\n";
      await writeFile(filePath, line, { flag: "a" });

      if (rawText !== undefined) {
        const rawPath = join(auditDir(), RAW_DIR, `${entry.id}.txt`);
        await writeFile(rawPath, rawText, "utf-8");
      }
    },

    async get(id: string): Promise<AuditEntryWithRaw | null> {
      // Scan all daily files for the entry
      const files = await readdir(auditDir()).catch(() => []);
      const jsonlFiles = files
        .filter((f) => f.startsWith("mcp-audit-") && f.endsWith(".jsonl"))
        .sort();

      for (const file of jsonlFiles) {
        const content = await readFile(join(auditDir(), file), "utf-8").catch(() => "");
        for (const line of content.split("\n").filter(Boolean)) {
          try {
            const entry = JSON.parse(line) as AuditEntry;
            if (entry.id === id) {
              const rawPath = join(auditDir(), RAW_DIR, `${id}.txt`);
              const rawText = await readFile(rawPath, "utf-8").catch(() => undefined);
              return { ...entry, rawText };
            }
          } catch {
            continue;
          }
        }
      }
      return null;
    },

    getRawPath(id: string): string {
      return join(auditDir(), RAW_DIR, `${id}.txt`);
    },
  };
}

export function createAuditEntry(
  tool: string,
  args: Record<string, unknown>,
  duration: number,
  error: string | null,
  resultPreview: AuditEntry["resultPreview"],
): AuditEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    tool,
    args,
    resultPreview,
    duration,
    error,
  };
}