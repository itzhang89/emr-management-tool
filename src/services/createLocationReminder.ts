import { stripSqlComments } from "./sqlLint";

const LOCATION_CLAUSE = /\bLOCATION\s+('[^']*'|"[^"]*")/i;
const CREATE_DATABASE = /\bCREATE\s+(?:DATABASE|SCHEMA)\b/i;
const CREATE_TABLE = /\bCREATE\s+(?:EXTERNAL\s+)?TABLE\b/i;
const CREATE_TABLE_AS = /\bCREATE\s+(?:EXTERNAL\s+)?TABLE\b[\s\S]*\bAS\b\s+SELECT\b/i;

function firstStatement(sql: string): string {
  return stripSqlComments(sql).trim().replace(/;+\s*$/, "").split(";")[0]?.trim() ?? "";
}

/** Returns true when CREATE DATABASE/SCHEMA or non-CTAS CREATE TABLE omits LOCATION. */
export function createStatementMissingLocation(sql: string): boolean {
  const statement = firstStatement(sql);
  if (!statement) return false;

  if (CREATE_DATABASE.test(statement)) {
    return !LOCATION_CLAUSE.test(statement);
  }

  if (CREATE_TABLE.test(statement)) {
    if (CREATE_TABLE_AS.test(statement)) return false;
    return !LOCATION_CLAUSE.test(statement);
  }

  return false;
}

export function createLocationReminderKind(sql: string): "database" | "table" | undefined {
  const statement = firstStatement(sql);
  if (!statement || LOCATION_CLAUSE.test(statement)) return undefined;
  if (CREATE_DATABASE.test(statement)) return "database";
  if (CREATE_TABLE.test(statement) && !CREATE_TABLE_AS.test(statement)) return "table";
  return undefined;
}
