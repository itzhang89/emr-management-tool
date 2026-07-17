import type { GlueDatabaseDetail } from "@/types/domain";
import { quoteHiveIdentifier } from "./hiveSql";

/** Glue/Athena often attaches these automatically; omit from copied CREATE DATABASE DDL. */
const DEFAULT_DATABASE_PARAMETER_KEYS = new Set(["createdby", "external"]);

function escapeSqlString(value: string) {
  return value.replace(/'/g, "''");
}

export function isDefaultDatabaseParameterKey(key: string) {
  return DEFAULT_DATABASE_PARAMETER_KEYS.has(key.trim().toLowerCase());
}

export function filterUserDatabaseParameters(parameters: Record<string, string>) {
  return Object.entries(parameters).filter(
    ([key, value]) => Boolean(key.trim()) && value != null && !isDefaultDatabaseParameterKey(key)
  );
}

export function buildCreateDatabaseDdl(database: GlueDatabaseDetail) {
  const lines: string[] = [`CREATE DATABASE IF NOT EXISTS ${quoteHiveIdentifier(database.name)}`];

  if (database.description?.trim()) {
    lines.push(`COMMENT '${escapeSqlString(database.description.trim())}'`);
  }

  if (database.locationUri?.trim()) {
    lines.push(`LOCATION '${escapeSqlString(database.locationUri.trim())}'`);
  }

  const properties = filterUserDatabaseParameters(database.parameters);
  if (properties.length > 0) {
    const body = properties
      .map(([key, value]) => `'${escapeSqlString(key)}' = '${escapeSqlString(value)}'`)
      .join(", ");
    lines.push(`WITH DBPROPERTIES (${body})`);
  }

  return `${lines.join("\n")};`;
}
