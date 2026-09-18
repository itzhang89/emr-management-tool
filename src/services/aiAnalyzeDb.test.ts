import { describe, expect, it } from "vitest";
import {
  connectionSlug,
  dbAnalysisPrompt,
  dbSessionTitle,
  executeSqlToolName,
  type DbAnalyzeIntent
} from "./aiAnalyzeDb";

describe("connectionSlug", () => {
  it("matches the Rust slug rules", () => {
    expect(connectionSlug("MySQL1")).toBe("mysql1");
    expect(connectionSlug("MySQL-Prod")).toBe("mysql_prod");
    expect(connectionSlug("  Sales DB!! ")).toBe("sales_db");
    expect(connectionSlug("___")).toBe("");
    expect(executeSqlToolName("bigdata_etl")).toBe("execute_sql_bigdata_etl");
    expect(executeSqlToolName("!!!")).toBeNull();
  });
});

describe("dbSessionTitle", () => {
  it("prefers table then schema then database", () => {
    const base: DbAnalyzeIntent = {
      connectionId: "c1",
      connectionName: "bigdata_etl",
      toolName: "execute_sql_bigdata_etl",
      instruction: "count rows"
    };
    expect(dbSessionTitle(base)).toBe("bigdata_etl");
    expect(dbSessionTitle({ ...base, database: "sales" })).toBe("bigdata_etl / sales");
    expect(dbSessionTitle({ ...base, database: "sales", schema: "public" })).toBe(
      "bigdata_etl / public"
    );
    expect(
      dbSessionTitle({ ...base, database: "sales", schema: "public", table: "orders" })
    ).toBe("bigdata_etl / orders");
  });
});

describe("dbAnalysisPrompt", () => {
  it("includes instruction and catalog context", () => {
    const prompt = dbAnalysisPrompt({
      connectionId: "c1",
      connectionName: "bigdata_etl",
      toolName: "execute_sql_bigdata_etl",
      database: "bigdata_etl",
      table: "job_log",
      instruction: "Summarise recent failures"
    });
    expect(prompt).toContain("Summarise recent failures");
    expect(prompt).toContain("execute_sql_bigdata_etl");
    expect(prompt).toContain("job_log");
    expect(prompt).toContain("c1");
  });
});
