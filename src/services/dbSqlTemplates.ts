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
  const lastWeek =
    kind === "mysql"
      ? "DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY)"
      : "CURRENT_DATE - INTERVAL '7 days'";

  return [
    { label: "Sample rows", sql: "SELECT *\nFROM your_table\nLIMIT 100;" },
    { label: "Count rows", sql: "SELECT COUNT(*) FROM your_table;" },
    {
      label: "Group and count",
      sql: "SELECT your_column, COUNT(*) AS n\nFROM your_table\nGROUP BY your_column\nORDER BY n DESC\nLIMIT 100;"
    },
    {
      label: "Join two tables",
      sql: "SELECT a.*, b.*\nFROM table_a a\nJOIN table_b b ON b.a_id = a.id\nLIMIT 100;"
    },
    {
      label: "Recent rows",
      sql: `SELECT *\nFROM your_table\nWHERE created_at >= ${lastWeek}\nORDER BY created_at DESC\nLIMIT 100;`
    },
    { label: "Explain a plan", sql: "EXPLAIN SELECT * FROM your_table;" }
  ];
}
