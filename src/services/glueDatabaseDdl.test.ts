import { describe, expect, it } from "vitest";
import { buildCreateDatabaseDdl, filterUserDatabaseParameters } from "./glueDatabaseDdl";
import type { GlueDatabaseDetail } from "@/types/domain";

const sampleDatabase: GlueDatabaseDetail = {
  name: "bdbstaging",
  catalogId: "123456789012",
  description: "Staging db",
  locationUri: "s3://bucket/bdbstaging.db/",
  createTime: "2026-01-01T00:00:00Z",
  parameters: {
    CreatedBy: "Athena",
    EXTERNAL: "TRUE",
    creator: "analytics",
    team: "data"
  }
};

describe("glueDatabaseDdl", () => {
  it("filters default auto-generated parameters", () => {
    expect(filterUserDatabaseParameters(sampleDatabase.parameters)).toEqual([
      ["creator", "analytics"],
      ["team", "data"]
    ]);
  });

  it("builds Athena CREATE DATABASE ddl without default parameters", () => {
    const ddl = buildCreateDatabaseDdl(sampleDatabase);
    expect(ddl).toContain("CREATE DATABASE IF NOT EXISTS bdbstaging");
    expect(ddl).toContain("COMMENT 'Staging db'");
    expect(ddl).toContain("LOCATION 's3://bucket/bdbstaging.db/'");
    expect(ddl).toContain("WITH DBPROPERTIES ('creator' = 'analytics', 'team' = 'data')");
    expect(ddl).not.toContain("CreatedBy");
    expect(ddl).not.toContain("EXTERNAL");
    expect(ddl).not.toContain("createTime");
  });

  it("omits empty optional clauses", () => {
    const ddl = buildCreateDatabaseDdl({
      name: "plain_db",
      catalogId: "1",
      parameters: { CreatedBy: "Athena" }
    });
    expect(ddl).toBe("CREATE DATABASE IF NOT EXISTS plain_db;");
  });
});
