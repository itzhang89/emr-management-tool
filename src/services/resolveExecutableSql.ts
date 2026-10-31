import { dbHubService } from "@/services/dbHubService";
import type { ParsedDbSqlStatement } from "@/types/domain";

/**
 * What the editor should send to the run path.
 *
 * `source` says how the text was chosen so the UI can highlight / warn without
 * re-deriving the decision.
 */
export type ExecutableSql = {
  sql: string;
  /** Present when the caret (not a user selection) picked the statement. */
  select?: { from: number; to: number };
  parseOk: boolean;
  parseError?: string;
  source: "selection" | "statement" | "buffer";
};

/**
 * Resolve what Cmd/Ctrl+Enter should run.
 *
 * 1. Non-empty selection → that text (unchanged selection).
 * 2. Else ask Rust for the statement at `offset` and select it.
 * 3. Else (no statements) → null.
 */
export async function resolveExecutableSql(options: {
  doc: string;
  /** CodeMirror UTF-16 document position (caret or selection head). */
  offset: number;
  selectionFrom: number;
  selectionTo: number;
  dialect?: string;
}): Promise<ExecutableSql | null> {
  const { doc, offset, selectionFrom, selectionTo, dialect } = options;
  if (selectionFrom !== selectionTo) {
    const sql = doc.slice(selectionFrom, selectionTo).trim();
    if (!sql) return null;
    return { sql, parseOk: true, source: "selection" };
  }

  const trimmed = doc.trim();
  if (!trimmed) return null;

  try {
    const parsed = await dbHubService.parseSql({ sql: doc, dialect, offset });
    if (parsed.atOffset == null || parsed.statements.length === 0) {
      return null;
    }
    const statement = parsed.statements[parsed.atOffset] as ParsedDbSqlStatement;
    const sql = statement.text.trim();
    if (!sql) return null;
    return {
      sql,
      select: { from: statement.start, to: statement.end },
      parseOk: statement.parseOk,
      parseError: statement.parseError,
      source: "statement"
    };
  } catch {
    // Parser IPC failed — fall back to the whole buffer so a transient
    // backend blip does not strand the user with a dead Run key.
    return { sql: trimmed, parseOk: false, parseError: "parse unavailable", source: "buffer" };
  }
}
