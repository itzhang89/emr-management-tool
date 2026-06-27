import { describe, expect, it } from "vitest";
import { buildSelectSql } from "./glueSqlTemplates";
import { quoteAthenaIdentifier, sanitizeAthenaSql } from "./athenaSql";

describe("athenaSql", () => {
  it("quotes identifiers with special characters", () => {
    expect(quoteAthenaIdentifier("ods__shiji__account")).toBe("ods__shiji__account");
    expect(quoteAthenaIdentifier("my-table")).toBe('"my-table"');
  });

  it("converts backticks to double quotes", () => {
    expect(sanitizeAthenaSql("SELECT * FROM `shiji`.`ods__shiji__account` LIMIT 100;")).toBe(
      'SELECT * FROM "shiji"."ods__shiji__account" LIMIT 100'
    );
  });

  it("drops redundant database prefix when database context is set", () => {
    expect(
      sanitizeAthenaSql('SELECT * FROM "shiji"."ods__shiji__account" LIMIT 100', "shiji")
    ).toBe('SELECT * FROM "ods__shiji__account" LIMIT 100');
  });

  it("builds select sql without catalog-qualified backticks", () => {
    expect(buildSelectSql("shiji", "ods__shiji__account")).toBe(
      "SELECT * FROM ods__shiji__account LIMIT 100"
    );
  });
});
