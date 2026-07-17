import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { createSqlCompletion, type SqlCatalogContext } from "./athenaSqlCompletion";

function completionsAt(sql: string, catalog: SqlCatalogContext) {
  const state = EditorState.create({ doc: sql });
  const context = new CompletionContext(state, sql.length, true);
  return createSqlCompletion(() => catalog)(context);
}

describe("athenaSqlCompletion", () => {
  const catalog: SqlCatalogContext = {
    databases: ["bdbstaging", "analytics"],
    tables: ["events", "orders"],
    selectedDatabase: "bdbstaging",
    resolveTables: async (database) =>
      database === "analytics" ? ["funnel", "sessions"] : database === "bdbstaging" ? ["events", "orders"] : []
  };

  it("suggests databases and tables after FROM", async () => {
    const result = await completionsAt("SELECT * FROM ", catalog);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["bdbstaging", "analytics", "events", "orders"]));
  });

  it("suggests tables after database dot", async () => {
    const result = await completionsAt("SHOW CREATE TABLE analytics.", catalog);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["funnel", "sessions"]));
  });

  it("suggests tables after SHOW CREATE TABLE", async () => {
    const result = await completionsAt("SHOW CREATE TABLE ", catalog);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["bdbstaging", "events"]));
  });
});
