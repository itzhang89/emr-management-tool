import { beforeEach, describe, expect, it } from "vitest";
import {
  logsJobIdSearchHistoryKey,
  readLogsJobIdSearchHistory,
  rememberLogsJobIdSearch
} from "./logsJobIdSearchHistory";

describe("logsJobIdSearchHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses account-scoped storage keys", () => {
    expect(logsJobIdSearchHistoryKey("acct-a")).toBe("emr-eks:logs-job-id-search-recent:acct-a");
  });

  it("stores and reads recent job ids per account", () => {
    rememberLogsJobIdSearch("acct-a", "job-a");
    rememberLogsJobIdSearch("acct-b", "job-b");

    expect(readLogsJobIdSearchHistory("acct-a")).toEqual(["job-a"]);
    expect(readLogsJobIdSearchHistory("acct-b")).toEqual(["job-b"]);
  });

  it("discards the legacy global history key without migrating", () => {
    window.localStorage.setItem(
      "emr-eks:logs-job-id-search-recent",
      JSON.stringify(["legacy-job"])
    );

    expect(readLogsJobIdSearchHistory("acct-a")).toEqual([]);
    expect(window.localStorage.getItem("emr-eks:logs-job-id-search-recent")).toBeNull();

    rememberLogsJobIdSearch("acct-a", "job-a");
    expect(readLogsJobIdSearchHistory("acct-a")).toEqual(["job-a"]);
    expect(window.localStorage.getItem("emr-eks:logs-job-id-search-recent")).toBeNull();
  });
});
