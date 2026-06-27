import { describe, expect, it } from "vitest";
import { analyzeSql, containsDdl, validateSqlForRun, analyzeDdlSyntax } from "./sqlLint";

describe("sqlLint", () => {
  it("flags empty sql as an error", () => {
    const result = validateSqlForRun("   ");
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toMatch(/empty/i);
  });

  it("allows valid ddl statements", () => {
    expect(containsDdl("DROP TABLE IF EXISTS orders")).toBe(true);
    expect(validateSqlForRun("DROP TABLE IF EXISTS orders").ok).toBe(true);
    expect(validateSqlForRun("CREATE TABLE demo (id string)").ok).toBe(true);
    expect(validateSqlForRun("ALTER TABLE demo ADD COLUMNS (tier string)").ok).toBe(true);
    expect(validateSqlForRun("MSCK REPAIR TABLE demo").ok).toBe(true);
  });

  it("blocks ddl statements with invalid syntax", () => {
    expect(validateSqlForRun("DROP TABLE").ok).toBe(false);
    expect(validateSqlForRun("CREATE TABLE").ok).toBe(false);
    expect(validateSqlForRun("ALTER TABLE").ok).toBe(false);
    expect(analyzeDdlSyntax("DROP TABLE")[0]?.message).toMatch(/DROP TABLE/i);
  });

  it("allows select statements", () => {
    const result = validateSqlForRun("SELECT * FROM orders", { selectedDatabase: "analytics" });
    expect(result.ok).toBe(true);
  });

  it("warns about unqualified tables when no database is selected", () => {
    const issues = analyzeSql("SELECT * FROM orders");
    expect(issues.some((issue) => issue.severity === "warning")).toBe(true);
  });

  it("detects unbalanced parentheses", () => {
    const result = validateSqlForRun("SELECT * FROM (SELECT 1");
    expect(result.ok).toBe(false);
    expect(result.messages.some((message) => /parentheses/i.test(message))).toBe(true);
  });

  it("ignores ddl keywords inside comments", () => {
    expect(validateSqlForRun("SELECT 1 -- DROP TABLE demo").ok).toBe(true);
    expect(validateSqlForRun("SELECT 1 /* CREATE TABLE demo */").ok).toBe(true);
  });
});
