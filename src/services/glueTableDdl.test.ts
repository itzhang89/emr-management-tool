import { describe, expect, it } from "vitest";
import { buildCreateTableDdl } from "./glueTableDdl";
import { isSystemTableParameterKey, filterUserTableParameters } from "./glueTableParameters";
import type { GlueTableDetail } from "@/types/domain";

const sampleTable: GlueTableDetail = {
  name: "events",
  databaseName: "analytics",
  catalogId: "123456789012",
  tableType: "EXTERNAL_TABLE",
  description: "Daily events",
  columns: [{ name: "id", type: "string", comment: "Event id" }],
  partitionKeys: [{ name: "dt", type: "string" }],
  parameters: {
    classification: "parquet",
    EXTERNAL: "TRUE",
    transient_lastDdlTime: "1710000000",
    "spark.sql.sources.provider": "parquet",
    team: "data"
  },
  location: "s3://bucket/analytics/events/",
  inputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
  outputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
  serdeLibrary: "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
  serdeParameters: { "serialization.format": "1", "path": "s3://bucket/analytics/events/" }
};

describe("glueTableParameters", () => {
  it("detects system parameter keys", () => {
    expect(isSystemTableParameterKey("EXTERNAL")).toBe(true);
    expect(isSystemTableParameterKey("transient_lastDdlTime")).toBe(true);
    expect(isSystemTableParameterKey("spark.sql.sources.provider")).toBe(true);
    expect(isSystemTableParameterKey("classification")).toBe(false);
  });

  it("keeps user parameters only", () => {
    expect(filterUserTableParameters(sampleTable.parameters)).toEqual([
      ["classification", "parquet"],
      ["team", "data"]
    ]);
  });
});

describe("buildCreateTableDdl", () => {
  it("builds an external table ddl with partitions and storage", () => {
    const ddl = buildCreateTableDdl(sampleTable);
    expect(ddl).toContain("CREATE EXTERNAL TABLE IF NOT EXISTS `analytics`.`events`");
    expect(ddl).toContain("`id` string COMMENT 'Event id'");
    expect(ddl).toContain("PARTITIONED BY (");
    expect(ddl).toContain("LOCATION 's3://bucket/analytics/events/'");
    expect(ddl).toContain("'classification'='parquet'");
    expect(ddl).toContain("'team'='data'");
  });

  it("omits auto-generated table and serde properties from ddl", () => {
    const ddl = buildCreateTableDdl(sampleTable);
    expect(ddl).not.toMatch(/'EXTERNAL'/i);
    expect(ddl).not.toContain("transient_lastDdlTime");
    expect(ddl).not.toContain("spark.sql");
    expect(ddl).not.toContain("serialization.format");
    expect(ddl).toContain("'path'='s3://bucket/analytics/events/'");
  });
});
