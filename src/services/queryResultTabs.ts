import type { AthenaQueryExecution, AthenaQueryResults } from "@/types/domain";

export interface QueryResultTab {
  id: string;
  title: string;
  sqlSnapshot: string;
  queryExecutionId?: string;
  results?: AthenaQueryResults;
  resultsLoading?: boolean;
  resultsError?: unknown;
  execution?: AthenaQueryExecution;
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTableToken(token: string): string | undefined {
  const parts = token.split(".");
  const tablePart = parts[parts.length - 1];
  if (!tablePart) return undefined;

  const name = unquoteIdentifier(tablePart);
  if (!name || name === "*") return undefined;
  return name;
}

export function formatResultTabTableName(name: string, maxLength = 22): string {
  if (name.length <= maxLength) return name;
  return `\u2026${name.slice(-(maxLength - 1))}`;
}

const TABLE_IDENTIFIER =
  /(?:(?:"[^"]*(?:""[^"]*)*"|`[^`]+`|[A-Za-z_][\w]*)\.)*(?:"[^"]*(?:""[^"]*)*"|`[^`]+`|[A-Za-z_][\w]*)/;

export function extractPrimaryTableName(sql: string): string | undefined {
  const normalized = sql.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;

  const ddlPatterns = [
    /\bDROP\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([^\s;]+)/i,
    /\bALTER\s+TABLE\s+([^\s;]+)/i,
    /\bMSCK\s+REPAIR\s+TABLE\s+([^\s;]+)/i,
    /\bCREATE\s+(?:EXTERNAL\s+)?TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([^\s(;]+)/i
  ];

  for (const pattern of ddlPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const tableName = parseTableToken(match[1]);
      if (tableName) return tableName;
    }
  }

  const fromMatch = normalized.match(/\bFROM\s+(\(?)/i);
  if (!fromMatch || fromMatch[1] === "(") return undefined;

  const fromIndex = fromMatch.index ?? -1;
  const afterFrom = normalized.slice(fromIndex + fromMatch[0].length).trim();
  const tableMatch = afterFrom.match(TABLE_IDENTIFIER);
  if (!tableMatch?.[0]) return undefined;

  return parseTableToken(tableMatch[0]);
}

export function buildResultTabTitle(sql: string, fallbackIndex = 1): string {
  const tableName = extractPrimaryTableName(sql);
  if (tableName) return formatResultTabTableName(tableName);
  return `Result ${fallbackIndex}`;
}

export function createQueryResultTab(index: number, partial?: Partial<QueryResultTab>): QueryResultTab {
  return {
    id: crypto.randomUUID(),
    title: `Result ${index}`,
    sqlSnapshot: "",
    resultsLoading: false,
    ...partial
  };
}
