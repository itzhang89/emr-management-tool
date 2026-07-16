import { describe, expect, it } from "vitest";
import { buildSelectSql, buildDescribeDatabaseSql } from "./glueSqlTemplates";
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

  it("builds describe database extended sql", () => {
    expect(buildDescribeDatabaseSql("bdbstaging")).toBe("DESCRIBE DATABASE EXTENDED bdbstaging");
  });
});
