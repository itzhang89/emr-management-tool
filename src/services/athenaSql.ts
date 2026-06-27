/** Athena engine v3 uses double-quoted identifiers, not MySQL backticks. */
export function quoteAthenaIdentifier(name: string): string {
  const trimmed = name.trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return trimmed;
  }
  return `"${trimmed.replace(/"/g, '""')}"`;
}

export function sanitizeAthenaSql(sql: string, database?: string): string {
  let normalized = sql.trim().replace(/;+\s*$/, "").replace(/`/g, '"');

  if (database?.trim()) {
    const db = database.trim();
    normalized = normalized.replaceAll(`"${db}".`, "").replaceAll(`${db}.`, "");
  }

  return normalized;
}
