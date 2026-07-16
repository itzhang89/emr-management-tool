/** Hive / Spark SQL identifier quoting (backticks). */
export function quoteHiveIdentifier(name: string): string {
  const trimmed = name.trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return trimmed;
  }
  return `\`${trimmed.replace(/`/g, "``")}\``;
}

export function qualifyHiveTable(databaseName: string, tableName: string): string {
  return `${quoteHiveIdentifier(databaseName)}.${quoteHiveIdentifier(tableName)}`;
}

export function sanitizeHiveSql(sql: string, database?: string): string {
  let normalized = sql.trim().replace(/;+\s*$/, "");

  if (database?.trim()) {
    const db = database.trim();
    const quotedPrefix = `\`${db}\`.`;
    normalized = normalized.replaceAll(quotedPrefix, "");
    const plainPrefix = `${db}.`;
    normalized = normalized.replaceAll(plainPrefix, "");
  }

  return normalized;
}
