/**
 * One MCP tool invocation, persisted to the local SQLite audit database
 * (mcp-audit.sqlite in the app data dir) and shown in the app's Audit Log tab.
 */
export interface AuditRecord {
  id: string;
  /** ISO-8601 timestamp of the call. */
  timestamp: string;
  /** "success" | "error". */
  status: string;
  tool: string;
  /** Request arguments as passed to the tool. */
  args: Record<string, unknown>;
  /** Full JSON of the tool's returned content (empty when the call failed). */
  result: Record<string, unknown>;
  /** Best-effort client name, e.g. "claude-cli/2.0.22". */
  client: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Error message when status is "error". */
  error: string | null;
}

export interface AuditStore {
  write(record: AuditRecord): void;
}
