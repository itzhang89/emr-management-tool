import { describe, expect, it } from "vitest";
import { buildCreateTableDdl } from "./glueTableDdl";
import type { GlueTableDetail } from "@/types/domain";

const sampleTable: GlueTableDetail = {
  name: "events",
  databaseName: "analytics",
  catalogId: "123456789012",
  tableType: "EXTERNAL_TABLE",
  description: "Daily events",
  columns: [{ name: "id", type: "string", comment: "Event id" }],
  partitionKeys: [{ name: "dt", type: "string" }],
  parameters: { classification: "parquet" },
  location: "s3://bucket/analytics/events/",
  inputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
  outputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
  serdeLibrary: "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
  serdeParameters: { "serialization.format": "1" }
};

describe("buildCreateTableDdl", () => {
  it("builds an external table ddl with partitions and storage", () => {
    const ddl = buildCreateTableDdl(sampleTable);
    expect(ddl).toContain("CREATE EXTERNAL TABLE IF NOT EXISTS `analytics`.`events`");
    expect(ddl).toContain("`id` string COMMENT 'Event id'");
    expect(ddl).toContain("PARTITIONED BY (");
    expect(ddl).toContain("LOCATION 's3://bucket/analytics/events/'");
    expect(ddl).toContain("TBLPROPERTIES");
  });
});
