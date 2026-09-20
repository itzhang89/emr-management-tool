import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_TAB_ID, useJobLogTabs } from "./useJobLogTabs";
import { logsTabStorageKey, readLogTabs } from "@/services/logsTabStorage";

let activeAccountId = "acct-a";

vi.mock("@/hooks/useAwsSettings", () => ({
  useActiveAwsAccount: () => ({ data: { id: activeAccountId, name: "Test", region: "us-east-1" } })
}));

const rememberLogsJobIdSearch = vi.fn();
vi.mock("@/services/logsJobIdSearchHistory", () => ({
  rememberLogsJobIdSearch: (...args: unknown[]) => rememberLogsJobIdSearch(...args)
}));

beforeEach(() => {
  activeAccountId = "acct-a";
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("useJobLogTabs", () => {
  it("starts with just the fixed tab and hydrates the account's saved tabs", async () => {
    window.localStorage.setItem(
      logsTabStorageKey("acct-a"),
      JSON.stringify({
        version: 1,
        activeTabId: "vc-1:job-1",
        tabs: [
          {
            id: "vc-1:job-1",
            jobId: "job-1",
            virtualClusterId: "vc-1",
            jobName: "nightly",
            openedAt: "2026-09-19T00:00:00.000Z",
            lastViewedAt: "2026-09-19T00:00:00.000Z",
            contentLength: 0
          }
        ]
      })
    );

    const { result } = renderHook(() => useJobLogTabs());

    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    expect(result.current.tabs[0]?.id).toBe(HISTORY_TAB_ID);
    expect(result.current.tabs[1]?.jobName).toBe("nightly");
    expect(result.current.activeTabId).toBe("vc-1:job-1");
    // Restoring is not the same as opening: the recently-viewed list must not
    // grow just because the cache was read.
    expect(rememberLogsJobIdSearch).not.toHaveBeenCalled();
  });

  it("never files one account's tabs under another account's key", async () => {
    const { result, rerender } = renderHook(() => useJobLogTabs());

    act(() => {
      result.current.openJobTab("job-a", "vc-a", "etl-a");
    });
    await waitFor(() => expect(readLogTabs("acct-a").tabs).toHaveLength(1));

    activeAccountId = "acct-b";
    rerender();

    // B has no tabs of its own, so it must come up empty rather than inheriting
    // A's — the write for A's tab flushes during the switch.
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    expect(result.current.tabs[0]?.id).toBe(HISTORY_TAB_ID);
    expect(readLogTabs("acct-b").tabs).toEqual([]);
    expect(readLogTabs("acct-a").tabs.map((tab) => tab.jobId)).toEqual(["job-a"]);
  });

  it("commits a close without waiting for the debounce", async () => {
    const { result } = renderHook(() => useJobLogTabs());
    act(() => {
      result.current.openJobTab("job-a", "vc-a", "etl-a");
    });
    await waitFor(() => expect(readLogTabs("acct-a").tabs).toHaveLength(1));

    act(() => {
      result.current.closeTab("vc-a:job-a");
    });

    // Immediately, not 400ms later: closing is the user releasing the cache,
    // and a close a crash could undo is not a release.
    expect(readLogTabs("acct-a").tabs).toEqual([]);
    expect(window.localStorage.getItem(logsTabStorageKey("acct-a"))).toBeNull();
  });

  it("activates an existing tab rather than opening a second one", async () => {
    const { result } = renderHook(() => useJobLogTabs());

    act(() => {
      result.current.openJobTab("job-a", "vc-a", "etl-a");
    });
    act(() => {
      result.current.selectTab(HISTORY_TAB_ID);
    });
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.openJobTab("job-a", "vc-a", "etl-a");
    });

    expect(outcome).toBe("activated");
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe("vc-a:job-a");
  });

  it("refuses past the limit and reports why", async () => {
    const { result } = renderHook(() => useJobLogTabs());

    act(() => {
      for (let index = 0; index < 10; index += 1) {
        result.current.openDraftTab();
      }
    });

    let outcome: string | undefined;
    act(() => {
      outcome = result.current.openJobTab("job-overflow", "vc-a", "etl");
    });

    expect(outcome).toBe("at-capacity");
    expect(result.current.tabs).toHaveLength(11);
  });

  it("remembers a job only when the user opens it, not when a draft is promoted blind", async () => {
    const { result } = renderHook(() => useJobLogTabs());
    await waitFor(() => expect(result.current.activeTabId).toBe(HISTORY_TAB_ID));

    act(() => {
      result.current.openJobTab("job-a", "vc-a", "etl-a");
    });
    expect(rememberLogsJobIdSearch).toHaveBeenCalledWith("acct-a", "job-a");
  });
});
