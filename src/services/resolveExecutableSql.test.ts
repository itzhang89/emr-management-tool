import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExecutableSql } from "./resolveExecutableSql";

const parseSql = vi.fn();

vi.mock("@/services/dbHubService", () => ({
  dbHubService: {
    parseSql: (...args: unknown[]) => parseSql(...args)
  }
}));

describe("resolveExecutableSql", () => {
  beforeEach(() => {
    parseSql.mockReset();
  });

  it("prefers a non-empty selection over the caret statement", async () => {
    const doc = "SELECT 1; SELECT 2;";
    const resolved = await resolveExecutableSql({
      doc,
      offset: 0,
      selectionFrom: 10,
      selectionTo: doc.length,
      dialect: "mysql"
    });

    expect(parseSql).not.toHaveBeenCalled();
    expect(resolved).toEqual({
      sql: "SELECT 2;",
      parseOk: true,
      source: "selection"
    });
  });

  it("selects the statement under the caret when nothing is selected", async () => {
    parseSql.mockResolvedValueOnce({
      statements: [
        { start: 0, end: 8, text: "SELECT 1", parseOk: true },
        { start: 10, end: 18, text: "SELECT 2", parseOk: true }
      ],
      atOffset: 1
    });

    const resolved = await resolveExecutableSql({
      doc: "SELECT 1; SELECT 2",
      offset: 12,
      selectionFrom: 12,
      selectionTo: 12,
      dialect: "postgres"
    });

    expect(parseSql).toHaveBeenCalledWith({
      sql: "SELECT 1; SELECT 2",
      dialect: "postgres",
      offset: 12
    });
    expect(resolved).toEqual({
      sql: "SELECT 2",
      select: { from: 10, to: 18 },
      parseOk: true,
      parseError: undefined,
      source: "statement"
    });
  });

  it("returns null when the document is empty", async () => {
    expect(
      await resolveExecutableSql({
        doc: "   \n",
        offset: 0,
        selectionFrom: 0,
        selectionTo: 0
      })
    ).toBeNull();
  });

  it("falls back to the whole buffer when parse IPC fails", async () => {
    parseSql.mockRejectedValueOnce(new Error("backend down"));

    const resolved = await resolveExecutableSql({
      doc: "SELECT 1",
      offset: 0,
      selectionFrom: 0,
      selectionTo: 0
    });

    expect(resolved).toEqual({
      sql: "SELECT 1",
      parseOk: false,
      parseError: "parse unavailable",
      source: "buffer"
    });
  });
});
