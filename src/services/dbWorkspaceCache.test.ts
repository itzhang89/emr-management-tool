import { beforeEach, describe, expect, it } from "vitest";
import {
  blankQueryTab,
  clearDbWorkspace,
  readDbWorkspace,
  writeDbWorkspace,
  DEFAULT_FETCH_SIZE,
  MAX_RESULT_TABS,
  RESULT_CACHE_ROW_BUDGET,
  type CachedQueryTab,
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
    pageable: true,
    catalogChanged: false
  };
}

function queryTab(sql: string, result?: DbQueryResult): CachedQueryTab {
  return {
    id: "q1",
    title: "Query 1",
    sql,
    fetchSize: DEFAULT_FETCH_SIZE,
    nextResultIndex: 2,
    activeResultTabId: "t1",
    resultTabs: [
      { id: "t1", title: "Result 1", sql, ranAt: "2026-09-08T00:00:00Z", result }
    ]
  };
}

function workspace(result?: DbQueryResult): DbWorkspaceState {
  return { queryTabs: [queryTab("SELECT * FROM orders;", result)], activeQueryTabId: "q1" };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("dbWorkspaceCache", () => {
  it("round-trips a workspace per (accountId, connectionId)", () => {
    writeDbWorkspace("acct-a", "c1", workspace(fakeResult(2)));

    const restored = readDbWorkspace("acct-a", "c1");
    expect(restored.queryTabs[0]?.sql).toBe("SELECT * FROM orders;");
    expect(restored.queryTabs[0]?.resultTabs[0]?.result?.rowCount).toBe(2);
    expect(restored.activeQueryTabId).toBe("q1");
  });

  it("keeps each editor's results with that editor", () => {
    const state: DbWorkspaceState = {
      queryTabs: [
        queryTab("SELECT 1;", fakeResult(1)),
        { ...queryTab("SELECT 2;", fakeResult(5)), id: "q2", title: "Query 2" }
      ]
    };
    writeDbWorkspace("acct-a", "c1", state);

    const restored = readDbWorkspace("acct-a", "c1");
    expect(restored.queryTabs).toHaveLength(2);
    expect(restored.queryTabs[0]?.resultTabs[0]?.result?.rowCount).toBe(1);
    expect(restored.queryTabs[1]?.resultTabs[0]?.result?.rowCount).toBe(5);
  });

  it("keeps accounts in separate key spaces", () => {
    writeDbWorkspace("acct-a", "c1", workspace(fakeResult(1)));
    writeDbWorkspace("acct-b", "c1", { queryTabs: [queryTab("SELECT 2;")] });

    // Same connection id, different accounts — drafts never overwrite each other.
    expect(readDbWorkspace("acct-a", "c1").queryTabs[0]?.sql).toBe("SELECT * FROM orders;");
    expect(readDbWorkspace("acct-b", "c1").queryTabs[0]?.sql).toBe("SELECT 2;");
  });

  it("drops oversized result bodies but keeps tab metadata", () => {
    const bigResult = fakeResult(RESULT_CACHE_ROW_BUDGET + 1);
    writeDbWorkspace("acct-a", "c1", workspace(bigResult));

    const restored = readDbWorkspace("acct-a", "c1");
    const tab = restored.queryTabs[0]?.resultTabs[0];
    expect(tab?.title).toBe("Result 1");
    expect(tab?.result).toBeUndefined();
    // The arrangement survives with the metadata, so a rerun lands back in the
    // grid the user had built rather than a fresh one.
    expect(tab?.sql).toBe("SELECT * FROM orders;");
  });

  it("keeps small results whole", () => {
    writeDbWorkspace("acct-a", "c1", workspace(fakeResult(5)));

    expect(readDbWorkspace("acct-a", "c1").queryTabs[0]?.resultTabs[0]?.result?.rowCount).toBe(5);
  });

  it("reads a result stored in the old one-record view as the grid, narrowed", () => {
    window.localStorage.setItem(
      "emr-eks:dbhub-ws:acct-a:c1",
      JSON.stringify({
        queryTabs: [
          {
            ...queryTab("SELECT * FROM orders;"),
            resultTabs: [
              {
                id: "t1",
                title: "Result 1",
                sql: "SELECT * FROM orders;",
                ranAt: "2026-09-08T00:00:00Z",
                result: fakeResult(2),
                view: "record"
              }
            ]
          }
        ]
      })
    );

    const tab = readDbWorkspace("acct-a", "c1").queryTabs[0]?.resultTabs[0];
    // `view` used to be three mutually exclusive choices with "record" among
    // them. A stored "record" was the grid narrowed to one row, which is
    // exactly the pair the fields mean now — so it comes back as that, rather
    // than falling through to the grid and quietly widening it.
    expect(tab?.view).toBe("grid");
    expect(tab?.singleRecord).toBe(true);
  });

  it("rolls the oldest editors and results off past the caps", () => {
    const many: CachedQueryTab = {
      ...queryTab("SELECT 1;"),
      resultTabs: Array.from({ length: MAX_RESULT_TABS + 3 }, (_, index) => ({
        id: `t${index}`,
        title: `Result ${index}`,
        sql: "SELECT 1;",
        ranAt: "2026-09-08T00:00:00Z"
      }))
    };
    writeDbWorkspace("acct-a", "c1", { queryTabs: [many] });

    const restored = readDbWorkspace("acct-a", "c1").queryTabs[0];
    expect(restored?.resultTabs).toHaveLength(MAX_RESULT_TABS);
    // The newest survive — the oldest are the ones that roll off.
    expect(restored?.resultTabs.at(-1)?.id).toBe(`t${MAX_RESULT_TABS + 2}`);
  });

  it("reads an empty workspace when nothing was stored", () => {
    expect(readDbWorkspace("acct-a", "missing")).toEqual({ queryTabs: [] });
  });

  it("clear removes only that workspace", () => {
    writeDbWorkspace("acct-a", "c1", workspace(fakeResult(1)));
    writeDbWorkspace("acct-a", "c2", { queryTabs: [queryTab("SELECT 9;")] });

    clearDbWorkspace("acct-a", "c1");

    expect(readDbWorkspace("acct-a", "c1")).toEqual({ queryTabs: [] });
    expect(readDbWorkspace("acct-a", "c2").queryTabs[0]?.sql).toBe("SELECT 9;");
  });

  // A draft that was open before the editor gained tabs is the one thing an
  // upgrade could silently destroy, so the old shape is read, not discarded.
  describe("migrating a workspace stored before editors had tabs", () => {
    const legacyKey = "emr-eks:dbhub-ws:acct-a:c1";

    it("wraps the old single editor and its results into one query tab", () => {
      window.localStorage.setItem(
        legacyKey,
        JSON.stringify({
          sql: "SELECT * FROM legacy;",
          activeResultTabId: "old-tab",
          resultTabs: [
            {
              id: "old-tab",
              title: "legacy",
              sql: "SELECT * FROM legacy;",
              ranAt: "2026-09-08T00:00:00Z",
              result: fakeResult(3)
            }
          ],
          selectedDatabase: "sales",
          catalogCollapsed: true
        })
      );

      const restored = readDbWorkspace("acct-a", "c1");
      expect(restored.queryTabs).toHaveLength(1);
      expect(restored.queryTabs[0]?.sql).toBe("SELECT * FROM legacy;");
      expect(restored.queryTabs[0]?.resultTabs[0]?.result?.rowCount).toBe(3);
      expect(restored.queryTabs[0]?.activeResultTabId).toBe("old-tab");
      // The tree selection and pane state are not result state — they carry over.
      expect(restored.selectedDatabase).toBe("sales");
      expect(restored.catalogCollapsed).toBe(true);
    });

    it("numbers the next result past the migrated ones", () => {
      window.localStorage.setItem(
        legacyKey,
        JSON.stringify({
          sql: "SELECT 1;",
          resultTabs: [
            { id: "a", title: "Result 1", sql: "SELECT 1;", ranAt: "" },
            { id: "b", title: "Result 2", sql: "SELECT 1;", ranAt: "" }
          ]
        })
      );

      // Otherwise the first run after the upgrade claims a name already in use.
      expect(readDbWorkspace("acct-a", "c1").queryTabs[0]?.nextResultIndex).toBe(3);
    });

    it("gives a migrated editor the default page size", () => {
      window.localStorage.setItem(legacyKey, JSON.stringify({ sql: "SELECT 1;", resultTabs: [] }));

      expect(readDbWorkspace("acct-a", "c1").queryTabs[0]?.fetchSize).toBe(DEFAULT_FETCH_SIZE);
    });
  });

  it("blankQueryTab carries the defaults the absent fields stand for", () => {
    const tab = blankQueryTab();

    expect(tab.fetchSize).toBe(DEFAULT_FETCH_SIZE);
    expect(tab.nextResultIndex).toBe(1);
    expect(tab.resultTabs).toEqual([]);
  });
});
