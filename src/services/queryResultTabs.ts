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

export function buildResultTabTitle(sql: string, fallbackIndex = 1): string {
  const line = sql.trim().split(/\s+/).slice(0, 8).join(" ");
  const compact = line.replace(/\s+/g, " ").trim();
  if (!compact) return `Result ${fallbackIndex}`;
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact;
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
