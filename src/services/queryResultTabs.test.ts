import { describe, expect, it, vi } from "vitest";
import {
  buildResultTabTitle,
  createQueryResultTab,
  extractPrimaryTableName,
  formatResultTabTableName,
  resolveResultTabTitle
} from "./queryResultTabs";

describe("queryResultTabs", () => {
  it("prefers table name from select queries", () => {
    expect(extractPrimaryTableName("SELECT * FROM orders LIMIT 100")).toBe("orders");
    expect(buildResultTabTitle("SELECT * FROM orders LIMIT 100")).toBe("orders");
  });

  it("extracts table names from qualified and quoted identifiers", () => {
    expect(extractPrimaryTableName('SELECT * FROM analytics."order facts" LIMIT 10')).toBe("order facts");
    expect(extractPrimaryTableName("SELECT * FROM `legacy-table`")).toBe("legacy-table");
    expect(extractPrimaryTableName("SELECT * FROM AwsDataCatalog.analytics.orders")).toBe("orders");
  });

  it("shows the trailing portion of long table names with a leading ellipsis only", () => {
    expect(formatResultTabTableName("enterprise_customer_orders_daily", 16)).toBe("\u2026er_orders_daily");
    expect(formatResultTabTableName("enterprise_customer_orders_daily", 16).endsWith("\u2026")).toBe(false);
    expect(buildResultTabTitle("SELECT * FROM enterprise_customer_orders_daily")).toBe("\u2026customer_orders_daily");
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

  it("prefers sqlparser primaryTable when resolveResultTabTitle parses", async () => {
    const parseSql = vi.fn().mockResolvedValue({
      statements: [{ primaryTable: "orders" }]
    });
    await expect(
      resolveResultTabTitle({
        sql: "SELECT 1",
        fallbackIndex: 4,
        parseSql
      })
    ).resolves.toBe("orders");
    expect(parseSql).toHaveBeenCalled();
  });

  it("falls back when parse has no primary table", async () => {
    const parseSql = vi.fn().mockResolvedValue({ statements: [{ primaryTable: undefined }] });
    await expect(
      resolveResultTabTitle({
        sql: "SELECT * FROM customers",
        fallbackIndex: 2,
        parseSql
      })
    ).resolves.toBe("customers");
  });
});
