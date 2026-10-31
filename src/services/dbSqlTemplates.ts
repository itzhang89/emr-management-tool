import type { DbConnectionKind } from "@/types/domain";

export interface SqlTemplate {
  label: string;
  sql: string;
}

/**
 * Starting points for a JDBC connection's editor.
 *
 * Deliberately all SELECT-shaped. The Glue workspace's templates are Hive DDL
 * — `CREATE TABLE`, `MSCK REPAIR` — and the read-only gate refuses every one of
 * them before it reaches a database, so reusing them here would hand the user
 * SQL the app immediately declines to run.
 *
 * `LIMIT` is spelled the same way on MySQL and Postgres; only the date
 * arithmetic differs, so that is the one template that branches.
 */
export function dbSqlTemplates(kind: DbConnectionKind): SqlTemplate[] {
  const isSqlServer = kind === "sqlserver";
  const lastWeek = isSqlServer
    ? "DATEADD(day, -7, CAST(GETDATE() AS date))"
    : kind === "mysql"
      ? "DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY)"
      : "CURRENT_DATE - INTERVAL '7 days'";
  const limitPrefix = isSqlServer ? "SELECT TOP 100" : "SELECT";
  const limitSuffix = isSqlServer ? "" : "\nLIMIT 100";

  return [
    {
      label: "Sample rows",
      sql: `${limitPrefix} *\nFROM your_table${limitSuffix};`
    },
    { label: "Count rows", sql: "SELECT COUNT(*) FROM your_table;" },
    {
      label: "Group and count",
      sql: isSqlServer
        ? "SELECT TOP 100 your_column, COUNT(*) AS n\nFROM your_table\nGROUP BY your_column\nORDER BY n DESC;"
        : "SELECT your_column, COUNT(*) AS n\nFROM your_table\nGROUP BY your_column\nORDER BY n DESC\nLIMIT 100;"
    },
    {
      label: "Join two tables",
      sql: isSqlServer
        ? "SELECT TOP 100 a.*, b.*\nFROM table_a a\nJOIN table_b b ON b.a_id = a.id;"
        : "SELECT a.*, b.*\nFROM table_a a\nJOIN table_b b ON b.a_id = a.id\nLIMIT 100;"
    },
    {
      label: "Recent rows",
      sql: isSqlServer
        ? `SELECT TOP 100 *\nFROM your_table\nWHERE created_at >= ${lastWeek}\nORDER BY created_at DESC;`
        : `SELECT *\nFROM your_table\nWHERE created_at >= ${lastWeek}\nORDER BY created_at DESC\nLIMIT 100;`
    },
    {
      label: "Explain a plan",
      sql: isSqlServer
        ? "SET SHOWPLAN_TEXT ON;\nSELECT * FROM your_table;\nSET SHOWPLAN_TEXT OFF;"
        : "EXPLAIN SELECT * FROM your_table;"
    }
  ];
}
