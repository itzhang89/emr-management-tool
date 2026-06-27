import { type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";

export interface SqlCatalogContext {
  databases: string[];
  tables: string[];
  selectedDatabase?: string;
  resolveColumns?: (database: string, table: string) => Promise<string[]>;
}

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "JOIN",
  "LEFT JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "ON",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS NULL",
  "DISTINCT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX"
];

const columnCache = new Map<string, string[]>();
const columnRequests = new Map<string, Promise<string[]>>();

function cacheKey(database: string, table: string) {
  return `${database}.${table}`;
}

async function loadColumns(
  context: SqlCatalogContext,
  database: string,
  table: string
): Promise<string[]> {
  const key = cacheKey(database, table);
  const cached = columnCache.get(key);
  if (cached) return cached;
  if (!context.resolveColumns) return [];

  const pending = columnRequests.get(key);
  if (pending) return pending;

  const request = context
    .resolveColumns(database, table)
    .then((columns) => {
      columnCache.set(key, columns);
      columnRequests.delete(key);
      return columns;
    })
    .catch(() => {
      columnRequests.delete(key);
      return [];
    });

  columnRequests.set(key, request);
  return request;
}

function toCompletions(options: string[], type: Completion["type"] = "text"): Completion[] {
  return options.filter(Boolean).map((label) => ({ label, type }));
}

function filterByPrefix(options: string[], prefix: string) {
  if (!prefix) return options;
  const lower = prefix.toLowerCase();
  return options.filter((option) => option.toLowerCase().startsWith(lower));
}

function extractTablesFromSql(sql: string, selectedDatabase?: string): Array<{ database: string; table: string }> {
  const normalized = sql.replace(/\s+/g, " ");
  const matches = normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/gi);
  const tables: Array<{ database: string; table: string }> = [];

  for (const match of matches) {
    const token = match[1];
    if (!token || token.startsWith("(")) continue;
    const parts = token.split(".");
    if (parts.length >= 2) {
      tables.push({ database: parts[0], table: parts[1] });
    } else if (selectedDatabase) {
      tables.push({ database: selectedDatabase, table: parts[0] });
    }
  }

  return tables;
}

export function createSqlCompletion(getContext: () => SqlCatalogContext): CompletionSource {
  return async (ctx: CompletionContext) => {
    const catalog = getContext();
    const doc = ctx.state.doc.toString();
    const before = doc.slice(0, ctx.pos);

    const dotted = ctx.matchBefore(/[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\.?/);
    if (dotted?.text.includes(".")) {
      const endsWithDot = dotted.text.endsWith(".");
      const segments = dotted.text.split(".");

      if (segments.length === 2 && endsWithDot) {
        const database = segments[0];
        if (database === catalog.selectedDatabase) {
          return {
            from: dotted.from,
            options: toCompletions(catalog.tables, "variable"),
            validFor: /^[\w.]*$/
          };
        }
      }

      if (segments.length >= 2 && endsWithDot) {
        const table = segments[segments.length - 2];
        const database = segments.length >= 3 ? segments[segments.length - 3] : catalog.selectedDatabase;
        if (database) {
          const columns = await loadColumns(catalog, database, table);
          const prefix = segments[segments.length - 1] ?? "";
          return {
            from: dotted.from,
            options: toCompletions(filterByPrefix(columns, prefix), "property"),
            validFor: /^[\w.]*$/
          };
        }
      }
    }

    const word = ctx.matchBefore(/[\w.]+/);
    if (!word && !ctx.explicit) return null;

    const token = word?.text ?? "";
    const from = word?.from ?? ctx.pos;

    if (/\b(FROM|JOIN)\s+[\w.]*$/i.test(before)) {
      const tableOptions = catalog.selectedDatabase
        ? catalog.tables
        : catalog.databases;
      return {
        from,
        options: toCompletions(filterByPrefix(tableOptions, token), "variable"),
        validFor: /^[\w.]*$/
      };
    }

    if (/\bSELECT\s+[\w.,\s]*$/i.test(before)) {
      const tables = extractTablesFromSql(doc, catalog.selectedDatabase);
      const columnSets = await Promise.all(
        tables.map(({ database, table }) => loadColumns(catalog, database, table))
      );
      const columns = Array.from(new Set(columnSets.flat()));
      if (columns.length > 0) {
        return {
          from,
          options: toCompletions(filterByPrefix(columns, token), "property"),
          validFor: /^[\w.]*$/
        };
      }
    }

    return {
      from,
      options: [
        ...toCompletions(filterByPrefix(SQL_KEYWORDS, token), "keyword"),
        ...toCompletions(filterByPrefix(catalog.databases, token), "namespace")
      ],
      validFor: /^[\w.]*$/
    };
  };
}

export function clearSqlCompletionCache() {
  columnCache.clear();
  columnRequests.clear();
}
