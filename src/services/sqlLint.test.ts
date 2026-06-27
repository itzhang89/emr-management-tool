import { describe, expect, it } from "vitest";
import { analyzeSql, containsDdl, validateSqlForRun } from "./sqlLint";

describe("sqlLint", () => {
  it("flags empty sql as an error", () => {
    const result = validateSqlForRun("   ");
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toMatch(/empty/i);
  });

  it("blocks ddl statements from running", () => {
    expect(containsDdl("DROP TABLE IF EXISTS orders")).toBe(true);
    const result = validateSqlForRun("CREATE TABLE demo (id string)");
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toMatch(/DDL/i);
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
