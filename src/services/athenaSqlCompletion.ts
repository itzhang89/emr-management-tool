import { type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";

export interface SqlCatalogContext {
  databases: string[];
  tables: string[];
  selectedDatabase?: string;
  resolveTables?: (database: string) => Promise<string[]>;
  resolveColumns?: (database: string, table: string) => Promise<string[]>;
}

/** Athena-supported keyword snippets for autocomplete. */
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
  "MAX",
  "CREATE EXTERNAL TABLE",
  "CREATE DATABASE",
  "CREATE SCHEMA",
  "DESCRIBE EXTENDED",
  "DESCRIBE FORMATTED",
  "SHOW CREATE TABLE",
  "SHOW CREATE VIEW",
  "SHOW DATABASES",
  "SHOW TABLES",
  "PARTITIONED BY",
  "STORED AS ORC",
  "STORED AS PARQUET",
  "LOCATION",
  "WITH DBPROPERTIES",
  "COMMENT",
  "MSCK REPAIR TABLE",
  "ALTER TABLE ADD COLUMNS",
  "DROP TABLE IF EXISTS"
];

const RELATION_CLAUSE =
  /\b(?:FROM|JOIN|SHOW\s+CREATE\s+(?:TABLE|VIEW)|DESCRIBE(?:\s+(?:EXTENDED|FORMATTED))?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|MSCK\s+REPAIR\s+TABLE|ALTER\s+TABLE)\s+[\w.`]*$/i;

const tableCache = new Map<string, string[]>();
const tableRequests = new Map<string, Promise<string[]>>();
const columnCache = new Map<string, string[]>();
const columnRequests = new Map<string, Promise<string[]>>();

function cacheKey(database: string, table: string) {
  return `${database}.${table}`;
}

async function loadTables(context: SqlCatalogContext, database: string): Promise<string[]> {
  if (!database) return [];
  if (database === context.selectedDatabase && context.tables.length > 0) {
    return context.tables;
  }

  const cached = tableCache.get(database);
  if (cached) return cached;
  if (!context.resolveTables) {
    return database === context.selectedDatabase ? context.tables : [];
  }

  const pending = tableRequests.get(database);
  if (pending) return pending;

  const request = context
    .resolveTables(database)
    .then((tables) => {
      tableCache.set(database, tables);
      tableRequests.delete(database);
      return tables;
    })
    .catch(() => {
      tableRequests.delete(database);
      return [];
    });

  tableRequests.set(database, request);
  return request;
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

function relationCompletions(
  catalog: SqlCatalogContext,
  token: string
): Completion[] {
  const databases = toCompletions(filterByPrefix(catalog.databases, token), "namespace");
  const tables = catalog.selectedDatabase
    ? toCompletions(filterByPrefix(catalog.tables, token), "variable")
    : [];
  const qualified =
    catalog.selectedDatabase && !token.includes(".")
      ? toCompletions(
          filterByPrefix(
            catalog.tables.map((table) => `${catalog.selectedDatabase}.${table}`),
            token
          ),
          "variable"
        )
      : [];
  return [...databases, ...tables, ...qualified];
}

export function createSqlCompletion(getContext: () => SqlCatalogContext): CompletionSource {
  return async (ctx: CompletionContext) => {
    const catalog = getContext();
    const doc = ctx.state.doc.toString();
    const before = doc.slice(0, ctx.pos);

    const dotted = ctx.matchBefore(/[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\.?/);
    if (dotted?.text.includes(".")) {
      const endsWithDot = dotted.text.endsWith(".");
      const segments = dotted.text.replace(/\.$/, "").split(".").filter(Boolean);

      if (segments.length === 1 && endsWithDot) {
        const database = segments[0];
        const tables = await loadTables(catalog, database);
        return {
          from: dotted.from + database.length + 1,
          options: toCompletions(tables, "variable"),
          validFor: /^[\w]*$/
        };
      }

      if (segments.length === 2 && !endsWithDot) {
        const [database, tablePrefix] = segments;
        const tables = await loadTables(catalog, database);
        return {
          from: dotted.from + database.length + 1,
          options: toCompletions(filterByPrefix(tables, tablePrefix), "variable"),
          validFor: /^[\w]*$/
        };
      }

      if (segments.length >= 2 && endsWithDot) {
        const table = segments[segments.length - 1];
        const database =
          segments.length >= 3 ? segments[segments.length - 2] : catalog.selectedDatabase;
        if (database) {
          const columns = await loadColumns(catalog, database, table);
          return {
            from: dotted.to,
            options: toCompletions(columns, "property"),
            validFor: /^[\w]*$/
          };
        }
      }

      if (segments.length >= 3 && !endsWithDot) {
        const columnPrefix = segments[segments.length - 1] ?? "";
        const table = segments[segments.length - 2];
        const database =
          segments.length >= 4 ? segments[segments.length - 3] : catalog.selectedDatabase;
        if (database) {
          const columns = await loadColumns(catalog, database, table);
          const tableStart =
            dotted.from +
            segments.slice(0, -1).join(".").length +
            (segments.length > 1 ? 1 : 0);
          return {
            from: tableStart,
            options: toCompletions(filterByPrefix(columns, columnPrefix), "property"),
            validFor: /^[\w]*$/
          };
        }
      }
    }

    const word = ctx.matchBefore(/[\w.]+/);
    if (!word && !ctx.explicit) return null;

    const token = word?.text ?? "";
    const from = word?.from ?? ctx.pos;

    if (RELATION_CLAUSE.test(before)) {
      if (token.includes(".")) {
        const [database, tablePrefix = ""] = token.split(".");
        const tables = await loadTables(catalog, database);
        return {
          from: from + database.length + 1,
          options: toCompletions(filterByPrefix(tables, tablePrefix), "variable"),
          validFor: /^[\w]*$/
        };
      }

      return {
        from,
        options: relationCompletions(catalog, token),
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
        ...toCompletions(filterByPrefix(catalog.databases, token), "namespace"),
        ...(catalog.selectedDatabase
          ? toCompletions(filterByPrefix(catalog.tables, token), "variable")
          : [])
      ],
      validFor: /^[\w.]*$/
    };
  };
}

export function clearSqlCompletionCache() {
  tableCache.clear();
  tableRequests.clear();
  columnCache.clear();
  columnRequests.clear();
}
