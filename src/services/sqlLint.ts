export type SqlLintSeverity = "error" | "warning";

export interface SqlLintIssue {
  from: number;
  to: number;
  severity: SqlLintSeverity;
  message: string;
}

export interface SqlLintOptions {
  selectedDatabase?: string;
}

const DDL_PATTERN = /\b(CREATE|DROP|ALTER|TRUNCATE)\b|\bMSCK\s+REPAIR\b/i;
const FROM_TABLE_PATTERN = /\bFROM\s+(?:(["'`])[\s\S]*?\1|[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/gi;

export function stripSqlComments(sql: string): string {
  let result = "";
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);

    if (rest.startsWith("--")) {
      const lineBreak = rest.search(/\r?\n/);
      index += lineBreak === -1 ? rest.length : lineBreak;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      index += end === -1 ? rest.length : end + 2;
      continue;
    }

    if (rest.startsWith("'")) {
      const end = findQuotedStringEnd(rest, "'");
      result += rest.slice(0, end);
      index += end;
      continue;
    }

    if (rest.startsWith('"')) {
      const end = findQuotedStringEnd(rest, '"');
      result += rest.slice(0, end);
      index += end;
      continue;
    }

    if (rest.startsWith("`")) {
      const end = findQuotedStringEnd(rest, "`");
      result += rest.slice(0, end);
      index += end;
      continue;
    }

    result += rest[0];
    index += 1;
  }

  return result;
}

function findQuotedStringEnd(value: string, quote: string): number {
  let index = 1;
  while (index < value.length) {
    if (value[index] === quote) {
      if (value[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return value.length;
}

export function containsDdl(sql: string): boolean {
  return DDL_PATTERN.test(stripSqlComments(sql));
}

function findUnbalancedPairs(sql: string, open: string, close: string): number | undefined {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (!inDouble && !inBacktick && char === "'" ) {
      if (inSingle && next === "'") {
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && !inBacktick && char === '"') {
      if (inDouble && next === '"') {
        index += 1;
        continue;
      }
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && char === "`") {
      inBacktick = !inBacktick;
      continue;
    }

    if (inSingle || inDouble || inBacktick) continue;

    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth < 0) return index;
    }
  }

  return depth === 0 ? undefined : sql.length - 1;
}

function hasUnqualifiedTableReference(sql: string): boolean {
  const normalized = stripSqlComments(sql);
  FROM_TABLE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FROM_TABLE_PATTERN.exec(normalized)) !== null) {
    const token = match[0].replace(/^FROM\s+/i, "").trim();
    if (!token || token.startsWith("(")) continue;
    if (!token.includes(".")) return true;
  }

  return false;
}

export function analyzeSql(sql: string, options: SqlLintOptions = {}): SqlLintIssue[] {
  const issues: SqlLintIssue[] = [];
  const trimmed = sql.trim();

  if (!trimmed) {
    return [
      {
        from: 0,
        to: Math.max(sql.length, 1),
        severity: "error",
        message: "SQL query is empty."
      }
    ];
  }

  const unclosedSingle = findUnbalancedPairs(sql, "'", "'");
  if (unclosedSingle !== undefined) {
    issues.push({
      from: unclosedSingle,
      to: Math.min(unclosedSingle + 1, sql.length),
      severity: "error",
      message: "Unclosed single-quoted string."
    });
  }

  const unclosedDouble = findUnbalancedPairs(sql, '"', '"');
  if (unclosedDouble !== undefined) {
    issues.push({
      from: unclosedDouble,
      to: Math.min(unclosedDouble + 1, sql.length),
      severity: "error",
      message: "Unclosed double-quoted identifier."
    });
  }

  const unclosedParen = findUnbalancedPairs(sql, "(", ")");
  if (unclosedParen !== undefined) {
    issues.push({
      from: unclosedParen,
      to: Math.min(unclosedParen + 1, sql.length),
      severity: "error",
      message: "Unbalanced parentheses."
    });
  }

  if (containsDdl(sql)) {
    issues.push({
      from: 0,
      to: sql.length,
      severity: "error",
      message:
        "DDL statements cannot be run from the query editor. Use Table Metadata for supported catalog changes."
    });
  }

  if (!options.selectedDatabase && hasUnqualifiedTableReference(sql)) {
    issues.push({
      from: 0,
      to: sql.length,
      severity: "warning",
      message: "Select a database in the catalog or qualify tables as database.table."
    });
  }

  return issues;
}

export function validateSqlForRun(sql: string, options: SqlLintOptions = {}) {
  const errors = analyzeSql(sql, options).filter((issue) => issue.severity === "error");
  return {
    ok: errors.length === 0,
    messages: errors.map((issue) => issue.message)
  };
}
