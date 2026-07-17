import { describe, expect, it } from "vitest";
import { analyzeSql, containsDdl, validateSqlForRun, analyzeDdlSyntax } from "./sqlLint";

describe("sqlLint", () => {
  it("flags empty sql as an error", () => {
    const result = validateSqlForRun("   ");
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toMatch(/empty/i);
  });

  it("allows valid ddl statements", () => {
    expect(containsDdl("DROP TABLE IF EXISTS orders")).toBe(true);
    expect(validateSqlForRun("DROP TABLE IF EXISTS orders").ok).toBe(true);
    expect(validateSqlForRun("CREATE TABLE demo (id string)").ok).toBe(true);
    expect(validateSqlForRun("ALTER TABLE demo ADD COLUMNS (tier string)").ok).toBe(true);
    expect(validateSqlForRun("MSCK REPAIR TABLE demo").ok).toBe(true);
  });

  it("blocks ddl statements with invalid syntax", () => {
    expect(validateSqlForRun("DROP TABLE").ok).toBe(false);
    expect(validateSqlForRun("CREATE TABLE").ok).toBe(false);
    expect(validateSqlForRun("ALTER TABLE").ok).toBe(false);
    expect(analyzeDdlSyntax("DROP TABLE")[0]?.message).toMatch(/DROP TABLE/i);
  });

  it("allows select statements", () => {
    const result = validateSqlForRun("SELECT * FROM orders", { selectedDatabase: "analytics" });
    expect(result.ok).toBe(true);
  });

  it("warns about unqualified tables when no database is selected", () => {
    const issues = analyzeSql("SELECT * FROM orders");
    expect(issues.some((issue) => issue.severity === "warning")).toBe(true);
  });

  it("detects unbalanced parentheses", () => {
    const result = validateSqlForRun("SELECT * FROM (SELECT 1");
    expect(result.ok).toBe(false);
    expect(result.messages.some((message) => /parentheses/i.test(message))).toBe(true);
  });

  it("warns when create database omits location", () => {
    const issues = analyzeSql("CREATE DATABASE IF NOT EXISTS demo COMMENT 'test'");
    expect(issues.some((issue) => issue.severity === "warning" && /LOCATION/i.test(issue.message))).toBe(true);
  });

  it("allows show create table and view", () => {
    expect(validateSqlForRun("SHOW CREATE TABLE bdbstaging.xxx").ok).toBe(true);
    expect(validateSqlForRun("SHOW CREATE VIEW analytics.orders_by_date").ok).toBe(true);
    expect(analyzeDdlSyntax("SHOW CREATE TABLE bdbstaging.xxx")).toEqual([]);
  });

  it("warns when create table omits location", () => {
    const issues = analyzeSql("CREATE EXTERNAL TABLE demo (id string) STORED AS PARQUET");
    expect(issues.some((issue) => issue.severity === "warning" && /LOCATION/i.test(issue.message))).toBe(true);
  });

  it("allows create table with location", () => {
    const result = validateSqlForRun(
      "CREATE EXTERNAL TABLE demo (id string) STORED AS PARQUET LOCATION 's3://bucket/demo/'"
    );
    expect(result.ok).toBe(true);
  });

  it("allows create table with backtick-qualified database.table names", () => {
    const sql = `CREATE EXTERNAL TABLE IF NOT EXISTS \`test\`.\`job_execution_history2\` (
  \`job_id\` bigint,
  \`job_name\` string
)
PARTITIONED BY (
  \`year\` string,
  \`month\` string,
  \`day\` string
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe'
STORED AS INPUTFORMAT
  'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat'
OUTPUTFORMAT
  'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat'
LOCATION 's3://manila-bigdata-etl/spark-warehouse/test.db/job_execution_history'`;

    expect(analyzeDdlSyntax(sql)).toEqual([]);
    expect(validateSqlForRun(sql).ok).toBe(true);
  });
});
