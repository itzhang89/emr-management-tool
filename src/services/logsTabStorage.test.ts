import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOG_TABS_VERSION,
  LOG_TAB_CONTENT_BUDGET,
  LOG_TAB_TOTAL_BUDGET,
  MAX_LOG_TABS,
  clearLogTabs,
  emptyLogTabsState,
  fitLogTabs,
  logsTabStorageKey,
  parseStoredLogTabs,
  readLogTabs,
  writeLogTabs,
  type LogTabRecord,
  type LogTabsState
} from "./logsTabStorage";

function tab(id: string, overrides: Partial<LogTabRecord> = {}): LogTabRecord {
  return {
    id,
    jobId: id,
    virtualClusterId: "vc-1",
    openedAt: "2026-09-20T00:00:00.000Z",
    lastViewedAt: "2026-09-20T00:00:00.000Z",
    contentLength: 0,
    ...overrides
  };
}

function withLog(id: string, text: string, extra: Partial<LogTabRecord> = {}): LogTabRecord {
  return tab(id, {
    content: { itemKey: "stderr", text, savedAt: "2026-09-20T01:00:00.000Z" },
    contentLength: text.length,
    ...extra
  });
}

function state(tabs: LogTabRecord[], activeTabId?: string): LogTabsState {
  return { version: LOG_TABS_VERSION, activeTabId, tabs };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("logsTabStorage", () => {
  it("round-trips the tab list and its cached log text", () => {
    writeLogTabs("acct-a", state([tab("vc-1:job-1", { jobName: "nightly" }), withLog("vc-1:job-2", "hello")], "vc-1:job-2"));

    const restored = readLogTabs("acct-a");
    expect(restored.tabs.map((entry) => entry.id)).toEqual(["vc-1:job-1", "vc-1:job-2"]);
    expect(restored.tabs[0]?.jobName).toBe("nightly");
    expect(restored.tabs[1]?.content?.text).toBe("hello");
    expect(restored.activeTabId).toBe("vc-1:job-2");
  });

  it("keeps accounts in separate key spaces", () => {
    writeLogTabs("acct-a", state([tab("vc-1:job-1")]));
    writeLogTabs("acct-b", state([tab("vc-2:job-2")]));

    expect(readLogTabs("acct-a").tabs[0]?.id).toBe("vc-1:job-1");
    expect(readLogTabs("acct-b").tabs[0]?.id).toBe("vc-2:job-2");
  });

  it("reads an empty state when nothing was stored", () => {
    expect(readLogTabs("acct-a")).toEqual(emptyLogTabsState());
  });

  it("discards a payload it did not write instead of rendering it", () => {
    // A payload from a different version, a hand-edited file, or a half-written
    // entry must read as "no saved tabs" — never crash the page on boot.
    window.localStorage.setItem(logsTabStorageKey("acct-a"), JSON.stringify({ version: 0, tabs: [{ id: 1 }] }));
    expect(parseStoredLogTabs({ version: 0, tabs: [] })).toEqual(emptyLogTabsState());
    expect(parseStoredLogTabs({ version: LOG_TABS_VERSION, tabs: "nope" })).toEqual(emptyLogTabsState());
    expect(parseStoredLogTabs(null)).toEqual(emptyLogTabsState());
    expect(readLogTabs("acct-a")).toEqual(emptyLogTabsState());

    window.localStorage.setItem(logsTabStorageKey("acct-a"), "{not json");
    expect(readLogTabs("acct-a")).toEqual(emptyLogTabsState());
  });

  it("drops records that are missing their identity but keeps the rest", () => {
    const parsed = parseStoredLogTabs({
      version: LOG_TABS_VERSION,
      tabs: [{ id: "vc-1:job-1", jobId: "job-1", virtualClusterId: "vc-1" }, { id: "no-job" }, "junk"]
    });

    expect(parsed.tabs.map((entry) => entry.id)).toEqual(["vc-1:job-1"]);
  });

  it("removes the key entirely once the last tab closes", () => {
    writeLogTabs("acct-a", state([tab("vc-1:job-1")]));
    expect(window.localStorage.getItem(logsTabStorageKey("acct-a"))).not.toBeNull();

    writeLogTabs("acct-a", state([]));

    expect(window.localStorage.getItem(logsTabStorageKey("acct-a"))).toBeNull();
    expect(readLogTabs("acct-a")).toEqual(emptyLogTabsState());
  });

  it("clearLogTabs forgets one account's tabs and leaves the other alone", () => {
    writeLogTabs("acct-a", state([tab("vc-1:job-1")]));
    writeLogTabs("acct-b", state([tab("vc-1:job-1")]));

    clearLogTabs("acct-a");

    expect(readLogTabs("acct-a").tabs).toEqual([]);
    expect(readLogTabs("acct-b").tabs).toHaveLength(1);
  });
});

describe("fitLogTabs", () => {
  it("truncates an oversized log and says so", () => {
    const fitted = fitLogTabs(state([withLog("vc-1:job-1", "x".repeat(LOG_TAB_CONTENT_BUDGET + 100))]));

    expect(fitted.tabs[0]?.content?.text).toHaveLength(LOG_TAB_CONTENT_BUDGET);
    expect(fitted.tabs[0]?.contentTruncated).toBe(true);
    expect(fitted.tabs[0]?.contentLength).toBe(LOG_TAB_CONTENT_BUDGET);
  });

  it("keeps a log that fits untouched", () => {
    const fitted = fitLogTabs(state([withLog("vc-1:job-1", "small")]));

    expect(fitted.tabs[0]?.content?.text).toBe("small");
    expect(fitted.tabs[0]?.contentTruncated).toBeUndefined();
  });

  it("drops text from the least recently viewed tabs first, keeping their identity", () => {
    const half = "y".repeat(LOG_TAB_CONTENT_BUDGET);
    const tabs = [
      withLog("vc-1:job-1", half, { jobName: "oldest", lastViewedAt: "2026-09-20T01:00:00.000Z" }),
      withLog("vc-1:job-2", half, { jobName: "middle", lastViewedAt: "2026-09-20T02:00:00.000Z" }),
      withLog("vc-1:job-3", half, { jobName: "newest", lastViewedAt: "2026-09-20T03:00:00.000Z" }),
      withLog("vc-1:job-4", half, { jobName: "oldest-2", lastViewedAt: "2026-09-20T00:30:00.000Z" }),
      withLog("vc-1:job-5", half, { jobName: "newest-2", lastViewedAt: "2026-09-20T04:00:00.000Z" }),
      withLog("vc-1:job-6", half, { jobName: "middle-2", lastViewedAt: "2026-09-20T02:30:00.000Z" })
    ];

    const fitted = fitLogTabs(state(tabs));

    // Six 200k payloads against a 1M budget: dropping the single oldest one
    // brings the rest under the line, so exactly one loses its text.
    const byId = new Map(fitted.tabs.map((entry) => [entry.id, entry]));
    expect(byId.get("vc-1:job-4")?.content).toBeUndefined();
    expect(byId.get("vc-1:job-4")?.contentDropped).toBe(true);
    expect(byId.get("vc-1:job-4")?.jobName).toBe("oldest-2");
    expect(byId.get("vc-1:job-1")?.content?.text).toHaveLength(LOG_TAB_CONTENT_BUDGET);
    expect(byId.get("vc-1:job-3")?.content?.text).toHaveLength(LOG_TAB_CONTENT_BUDGET);
    expect(fitted.tabs.reduce((sum, entry) => sum + entry.contentLength, 0)).toBeLessThanOrEqual(LOG_TAB_TOTAL_BUDGET);
  });

  it("keeps the tabs in strip order after eviction picks a winner", () => {
    const half = "z".repeat(LOG_TAB_CONTENT_BUDGET);
    const fitted = fitLogTabs(
      state([
        withLog("vc-1:job-1", half, { lastViewedAt: "2026-09-20T01:00:00.000Z" }),
        withLog("vc-1:job-2", half, { lastViewedAt: "2026-09-20T05:00:00.000Z" }),
        withLog("vc-1:job-3", half, { lastViewedAt: "2026-09-20T02:00:00.000Z" })
      ])
    );

    expect(fitted.tabs.map((entry) => entry.id)).toEqual(["vc-1:job-1", "vc-1:job-2", "vc-1:job-3"]);
  });

  it("caps the tab count, keeping the most recently viewed", () => {
    const tabs = Array.from({ length: MAX_LOG_TABS + 2 }, (_, index) =>
      tab(`vc-1:job-${index}`, { lastViewedAt: `2026-09-20T00:${String(index).padStart(2, "0")}:00.000Z` })
    );

    const fitted = fitLogTabs(state(tabs));

    expect(fitted.tabs).toHaveLength(MAX_LOG_TABS);
    expect(fitted.tabs.map((entry) => entry.id)).not.toContain("vc-1:job-0");
    expect(fitted.tabs.map((entry) => entry.id)).not.toContain("vc-1:job-1");
  });

  it("forgets an active tab that did not survive", () => {
    const fitted = fitLogTabs(state([tab("vc-1:job-1")], "vc-1:gone"));

    expect(fitted.activeTabId).toBeUndefined();
  });
});

describe("writeLogTabs quota handling", () => {
  it("falls back to a metadata-only payload when the origin is full", () => {
    // The suite's localStorage is an in-memory stand-in, not jsdom's Storage,
    // so the spy goes on the instance the module actually calls.
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    writeLogTabs("acct-a", state([withLog("vc-1:job-1", "hello", { jobName: "nightly" })]));
    setItem.mockRestore();

    const restored = readLogTabs("acct-a");
    expect(restored.tabs[0]?.jobName).toBe("nightly");
    expect(restored.tabs[0]?.content).toBeUndefined();
    expect(restored.tabs[0]?.contentDropped).toBe(true);
  });

  it("keeps the previous payload when even the metadata-only write fails", () => {
    writeLogTabs("acct-a", state([withLog("vc-1:job-1", "hello")]));
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(() => writeLogTabs("acct-a", state([withLog("vc-1:job-2", "second")]))).not.toThrow();
    setItem.mockRestore();

    expect(readLogTabs("acct-a").tabs[0]?.id).toBe("vc-1:job-1");
  });
});
