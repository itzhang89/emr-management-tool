/**
 * Turning a DBHub connection workspace into a Chat analysis: a conversation
 * title from the connection / table, and the message to auto-send after the
 * user types an instruction.
 *
 * Mirrors {@link ./aiAnalyzeJob.ts} (Job History → AI), but always starts a
 * *new* session — table-level analyses do not reuse prior conversations.
 */

export interface DbAnalyzeIntent {
  connectionId: string;
  connectionName: string;
  /** MCP tool the model should prefer, e.g. execute_sql_bigdata_etl. */
  toolName: string;
  database?: string;
  schema?: string;
  table?: string;
  /** The user's free-form instruction from the modal. */
  instruction: string;
}

/**
 * Connection display name → slug half of `execute_sql_<slug>`.
 * Must stay aligned with `connection_slug` in `mcp/tools/dbhub_sql.rs`.
 */
export function connectionSlug(name: string): string {
  let out = "";
  let pendingUnderscore = false;
  for (const ch of name) {
    const lower = ch.toLowerCase();
    if (/[a-z0-9]/.test(lower)) {
      if (pendingUnderscore && out.length > 0) out += "_";
      out += lower;
      pendingUnderscore = false;
    } else {
      pendingUnderscore = true;
    }
  }
  return out;
}

export function executeSqlToolName(connectionName: string): string | null {
  const slug = connectionSlug(connectionName);
  return slug ? `execute_sql_${slug}` : null;
}

/** Session title: `Connection / table`, falling back to schema or database. */
export function dbSessionTitle(intent: DbAnalyzeIntent): string {
  const focus = intent.table ?? intent.schema ?? intent.database;
  if (focus) return `${intent.connectionName} / ${focus}`;
  return intent.connectionName;
}

/** The message auto-sent after the user confirms the instruction modal. */
export function dbAnalysisPrompt(intent: DbAnalyzeIntent): string {
  const lines = [
    intent.instruction.trim(),
    "",
    "Context (use the named read-only SQL tool; do not invent connection ids):",
    `- connection: ${intent.connectionName} (id ${intent.connectionId})`,
    `- tool: ${intent.toolName}`
  ];
  if (intent.database) lines.push(`- database: ${intent.database}`);
  if (intent.schema) lines.push(`- schema: ${intent.schema}`);
  if (intent.table) lines.push(`- table: ${intent.table}`);
  lines.push(
    "",
    "Prefer SELECT/SHOW/DESCRIBE against this connection. Cap rows and explain what you found."
  );
  return lines.join("\n");
}
