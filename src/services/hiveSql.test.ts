import { describe, expect, it } from "vitest";
import { buildSelectSql, SQL_DDL_TEMPLATES } from "./glueSqlTemplates";
import { quoteHiveIdentifier, qualifyHiveTable, sanitizeHiveSql } from "./hiveSql";

describe("hiveSql", () => {
  it("quotes identifiers with special characters using backticks", () => {
    expect(quoteHiveIdentifier("ods__shiji__account")).toBe("ods__shiji__account");
    expect(quoteHiveIdentifier("my-table")).toBe("`my-table`");
  });

  it("qualifies database and table names", () => {
    expect(qualifyHiveTable("shiji", "ods__shiji__account")).toBe("shiji.ods__shiji__account");
    expect(qualifyHiveTable("my-db", "my-table")).toBe("`my-db`.`my-table`");
  });

  it("preserves backticks in sql", () => {
    expect(sanitizeHiveSql("SELECT * FROM `shiji`.`ods__shiji__account` LIMIT 100;")).toBe(
      "SELECT * FROM `shiji`.`ods__shiji__account` LIMIT 100"
    );
  });

  it("drops redundant database prefix when database context is set", () => {
    expect(
      sanitizeHiveSql("SELECT * FROM `shiji`.`ods__shiji__account` LIMIT 100", "shiji")
    ).toBe("SELECT * FROM `ods__shiji__account` LIMIT 100");
  });

  it("builds hive-style select sql with qualified table", () => {
    expect(buildSelectSql("shiji", "ods__shiji__account")).toBe(
      "SELECT * FROM shiji.ods__shiji__account LIMIT 100"
    );
  });

  it("uses Athena CREATE DATABASE template without DESCRIBE DATABASE", () => {
    const createDb = SQL_DDL_TEMPLATES.find((template) => template.label === "CREATE DATABASE");
    expect(createDb?.sql).toContain("CREATE DATABASE IF NOT EXISTS");
    expect(createDb?.sql).toContain("LOCATION");
    expect(createDb?.sql).toContain("WITH DBPROPERTIES");
    expect(SQL_DDL_TEMPLATES.map((template) => template.label)).not.toContain("DESCRIBE DATABASE");
    expect(SQL_DDL_TEMPLATES.map((template) => template.label)).toContain("SHOW CREATE VIEW");
  });
});
