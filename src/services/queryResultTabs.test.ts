import { describe, expect, it } from "vitest";
import { buildResultTabTitle, createQueryResultTab, extractPrimaryTableName } from "./queryResultTabs";

describe("queryResultTabs", () => {
  it("prefers table name from select queries", () => {
    expect(extractPrimaryTableName("SELECT * FROM orders LIMIT 100")).toBe("orders");
    expect(buildResultTabTitle("SELECT * FROM orders LIMIT 100")).toBe("orders");
  });

  it("extracts table names from qualified and quoted identifiers", () => {
    expect(extractPrimaryTableName('SELECT * FROM analytics."order facts" LIMIT 10')).toBe("order facts");
    expect(extractPrimaryTableName("SELECT * FROM `legacy-table`")).toBe("legacy-table");
  });

  it("extracts table names from ddl statements", () => {
    expect(extractPrimaryTableName("DROP TABLE IF EXISTS staging_events")).toBe("staging_events");
    expect(extractPrimaryTableName("ALTER TABLE customer_profiles ADD COLUMNS (tier string)")).toBe(
      "customer_profiles"
    );
    expect(extractPrimaryTableName("MSCK REPAIR TABLE partitioned_logs")).toBe("partitioned_logs");
  });

  it("falls back to numbered result titles when no table is found", () => {
    expect(buildResultTabTitle("SELECT 1")).toBe("Result 1");
    expect(buildResultTabTitle("SHOW DATABASES", 3)).toBe("Result 3");
  });

  it("creates tabs with defaults", () => {
    const tab = createQueryResultTab(2);
    expect(tab.title).toBe("Result 2");
    expect(tab.id).toBeTruthy();
  });
});
