import { describe, expect, it } from "vitest";
import { buildResultTabTitle, createQueryResultTab } from "./queryResultTabs";

describe("queryResultTabs", () => {
  it("builds a short title from sql", () => {
    expect(buildResultTabTitle("SELECT * FROM orders LIMIT 100")).toBe("SELECT * FROM orders LIMIT 100");
  });

  it("truncates long sql titles", () => {
    const title = buildResultTabTitle("SELECT " + "very_long_column_name, ".repeat(10));
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(49);
  });

  it("creates tabs with defaults", () => {
    const tab = createQueryResultTab(2);
    expect(tab.title).toBe("Result 2");
    expect(tab.id).toBeTruthy();
  });
});
