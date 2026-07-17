/** Common Athena / Hive primitive and nested types for column editors. */
export const ATHENA_COLUMN_TYPES = [
  "string",
  "boolean",
  "tinyint",
  "smallint",
  "int",
  "bigint",
  "float",
  "double",
  "decimal(10,2)",
  "decimal(18,4)",
  "date",
  "timestamp",
  "binary",
  "varchar(255)",
  "char(10)",
  "array<string>",
  "map<string,string>",
  "struct<field:string>"
] as const;

export function columnTypeOptions(currentType?: string) {
  const options = [...ATHENA_COLUMN_TYPES];
  const trimmed = currentType?.trim();
  if (trimmed && !options.includes(trimmed as (typeof ATHENA_COLUMN_TYPES)[number])) {
    options.unshift(trimmed as (typeof ATHENA_COLUMN_TYPES)[number]);
  }
  return options;
}
