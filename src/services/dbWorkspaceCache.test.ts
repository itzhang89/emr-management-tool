import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDbWorkspace,
  readDbWorkspace,
  writeDbWorkspace,
  RESULT_CACHE_ROW_BUDGET,
  type DbWorkspaceState
} from "./dbWorkspaceCache";
import type { DbQueryResult } from "@/types/domain";

function fakeResult(rows: number): DbQueryResult {
  return {
    columns: ["id", "name"],
    rows: Array.from({ length: rows }, (_, index) => ({ id: index, name: `row-${index}` })),
    rowCount: rows,
    truncated: false,
    durationMs: 12,
    offset: 0,
    pageable: true
  };
}

function workspace(result: DbQueryResult): DbWorkspaceState {
  return {
    sql: "SELECT * FROM orders;",
    activeResultTabId: "t1",
    resultTabs: [
      { id: "t1", title: "SELECT * FROM orders", sql: "SELECT * FROM orders;", ranAt: "2026-09-08T00:00:00Z", result }
    ]
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("dbWorkspaceCache", () => {
  it("round-trips a workspace per (accountId, connectionId)", () => {
    const state = workspace(fakeResult(2));
    writeDbWorkspace("acct-a", "c1", state);

    expect(readDbWorkspace("acct-a", "c1").sql).toBe("SELECT * FROM orders;");
    expect(readDbWorkspace("acct-a", "c1").resultTabs[0]?.result?.rowCount).toBe(2);
  });

  it("keeps accounts in separate key spaces", () => {
    writeDbWorkspace("acct-a", "c1", workspace(fakeResult(1)));
    writeDbWorkspace("acct-b", "c1", { sql: "SELECT 2;", resultTabs: [] });

    // Same connection id, different accounts — drafts never overwrite each other.
    expect(readDbWorkspace("acct-a", "c1").sql).toBe("SELECT * FROM orders;");
    expect(readDbWorkspace("acct-b", "c1").sql).toBe("SELECT 2;");
  });

  it("drops oversized result bodies but keeps tab metadata", () => {
    const bigResult = fakeResult(RESULT_CACHE_ROW_BUDGET + 1);
    writeDbWorkspace("acct-a", "c1", workspace(bigResult));

    const restored = readDbWorkspace("acct-a", "c1");
    expect(restored.resultTabs[0]?.title).toBe("SELECT * FROM orders");
    expect(restored.resultTabs[0]?.result).toBeUndefined();
  });

  it("keeps small results whole", () => {
    writeDbWorkspace("acct-a", "c1", workspace(fakeResult(5)));

    const restored = readDbWorkspace("acct-a", "c1");
    expect(restored.resultTabs[0]?.result?.rowCount).toBe(5);
  });

  it("reads an empty workspace when nothing was stored", () => {
    expect(readDbWorkspace("acct-a", "missing")).toEqual({ sql: "", resultTabs: [] });
  });

  it("clear removes only that workspace", () => {
    writeDbWorkspace("acct-a", "c1", workspace(fakeResult(1)));
    writeDbWorkspace("acct-a", "c2", { sql: "SELECT 9;", resultTabs: [] });

    clearDbWorkspace("acct-a", "c1");

    expect(readDbWorkspace("acct-a", "c1")).toEqual({ sql: "", resultTabs: [] });
    expect(readDbWorkspace("acct-a", "c2").sql).toBe("SELECT 9;");
  });
});
