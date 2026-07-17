import { qualifyHiveTable, quoteHiveIdentifier, sanitizeHiveSql } from "./hiveSql";

/** Athena-supported DDL/DML snippets only. */
export const SQL_DDL_TEMPLATES = [
  {
    label: "SELECT sample",
    sql: "SELECT * FROM database_name.table_name LIMIT 100"
  },
  {
    label: "CREATE DATABASE",
    sql: `CREATE DATABASE IF NOT EXISTS my_database
COMMENT 'Database description'
LOCATION 's3://bucket/path/my_database.db/'
WITH DBPROPERTIES ('creator' = 'example')`
  },
  {
    label: "CREATE ORC table",
    sql: `CREATE EXTERNAL TABLE IF NOT EXISTS database_name.table_name (
  id bigint,
  value string
)
PARTITIONED BY (year string, month string, day string)
STORED AS ORC
LOCATION 's3://bucket/path/table_name'`
  },
  {
    label: "CREATE Parquet table",
    sql: `CREATE EXTERNAL TABLE IF NOT EXISTS database_name.table_name (
  id string,
  value string
)
PARTITIONED BY (dt string)
STORED AS PARQUET
LOCATION 's3://bucket/path/'`
  },
  {
    label: "DESCRIBE TABLE",
    sql: "DESCRIBE EXTENDED database_name.table_name"
  },
  {
    label: "SHOW CREATE TABLE",
    sql: "SHOW CREATE TABLE database_name.table_name"
  },
  {
    label: "SHOW CREATE VIEW",
    sql: "SHOW CREATE VIEW database_name.view_name"
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
  return `SELECT * FROM ${qualifyHiveTable(databaseName, tableName)} LIMIT 100`;
}

export function buildDropTableSql(databaseName: string, tableName: string) {
  return `DROP TABLE IF EXISTS ${qualifyHiveTable(databaseName, tableName)}`;
}

export function buildDescribeTableSql(databaseName: string, tableName: string) {
  return `DESCRIBE EXTENDED ${qualifyHiveTable(databaseName, tableName)}`;
}

export { sanitizeHiveSql as sanitizeAthenaSql, quoteHiveIdentifier };
