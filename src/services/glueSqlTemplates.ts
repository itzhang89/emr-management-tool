import { quoteAthenaIdentifier, sanitizeAthenaSql } from "./athenaSql";

export const SQL_DDL_TEMPLATES = [
  {
    label: "SELECT sample",
    sql: "SELECT * FROM table_name LIMIT 100"
  },
  {
    label: "CREATE DATABASE",
    sql: "CREATE DATABASE IF NOT EXISTS my_database\nCOMMENT 'Database description'"
  },
  {
    label: "CREATE Parquet table",
    sql: `CREATE EXTERNAL TABLE IF NOT EXISTS table_name (
  id string,
  value string
)
PARTITIONED BY (dt string)
STORED AS PARQUET
LOCATION 's3://bucket/path/'`
  },
  {
    label: "ALTER ADD COLUMNS",
    sql: "ALTER TABLE table_name ADD COLUMNS (new_col string)"
  },
  {
    label: "MSCK REPAIR TABLE",
    sql: "MSCK REPAIR TABLE table_name"
  },
  {
    label: "DROP TABLE",
    sql: "DROP TABLE IF EXISTS table_name"
  }
] as const;

export function buildSelectSql(databaseName: string, tableName: string) {
  void databaseName;
  return `SELECT * FROM ${quoteAthenaIdentifier(tableName)} LIMIT 100`;
}

export function buildDropTableSql(databaseName: string, tableName: string) {
  void databaseName;
  return `DROP TABLE IF EXISTS ${quoteAthenaIdentifier(tableName)}`;
}

export { sanitizeAthenaSql };
