import type { GlueTableDetail } from "@/types/domain";

function escapeSqlString(value: string) {
  return value.replace(/'/g, "''");
}

function quoteIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

function formatColumnLine(column: GlueTableDetail["columns"][number]) {
  const comment = column.comment ? ` COMMENT '${escapeSqlString(column.comment)}'` : "";
  return `  ${quoteIdentifier(column.name)} ${column.type}${comment}`;
}

function formatPartitionLine(column: GlueTableDetail["partitionKeys"][number]) {
  const comment = column.comment ? ` COMMENT '${escapeSqlString(column.comment)}'` : "";
  return `  ${quoteIdentifier(column.name)} ${column.type}${comment}`;
}

function formatTableProperties(parameters: Record<string, string>) {
  const entries = Object.entries(parameters);
  if (entries.length === 0) return "";
  const body = entries.map(([key, value]) => `  '${escapeSqlString(key)}'='${escapeSqlString(value)}'`).join(",\n");
  return `\nTBLPROPERTIES (\n${body}\n)`;
}

export function buildCreateTableDdl(table: GlueTableDetail) {
  const lines: string[] = [];
  const header = table.tableType?.toUpperCase().includes("EXTERNAL")
    ? "CREATE EXTERNAL TABLE"
    : "CREATE EXTERNAL TABLE";
  lines.push(`${header} IF NOT EXISTS ${quoteIdentifier(table.databaseName)}.${quoteIdentifier(table.name)} (`);

  if (table.columns.length === 0) {
    lines.push("  placeholder string");
  } else {
    lines.push(table.columns.map(formatColumnLine).join(",\n"));
  }
  lines.push(")");

  if (table.partitionKeys.length > 0) {
    lines.push("PARTITIONED BY (");
    lines.push(table.partitionKeys.map(formatPartitionLine).join(",\n"));
    lines.push(")");
  }

  if (table.serdeLibrary) {
    lines.push(`ROW FORMAT SERDE '${escapeSqlString(table.serdeLibrary)}'`);
    const serdeParams = Object.entries(table.serdeParameters);
    if (serdeParams.length > 0) {
      const body = serdeParams
        .map(([key, value]) => `'${escapeSqlString(key)}'='${escapeSqlString(value)}'`)
        .join(",\n  ");
      lines.push("WITH SERDEPROPERTIES (");
      lines.push(`  ${body}`);
      lines.push(")");
    }
  }

  if (table.inputFormat && table.outputFormat) {
    lines.push("STORED AS INPUTFORMAT");
    lines.push(`  '${escapeSqlString(table.inputFormat)}'`);
    lines.push("OUTPUTFORMAT");
    lines.push(`  '${escapeSqlString(table.outputFormat)}'`);
  }

  if (table.location) {
    lines.push(`LOCATION '${escapeSqlString(table.location)}'`);
  }

  if (table.description) {
    lines.push(`COMMENT '${escapeSqlString(table.description)}'`);
  }

  const properties = formatTableProperties(table.parameters);
  if (properties) {
    lines.push(properties.trim());
  }

  return `${lines.join("\n")};`;
}
