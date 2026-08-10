import { beforeEach, describe, expect, it } from "vitest";
import {
  JOB_HISTORY_SEARCH_HISTORY_LIMIT,
  jobHistorySearchHistoryKey,
  readJobHistorySearchHistory,
  rememberJobHistorySearch
} from "./jobHistorySearchHistory";

describe("jobHistorySearchHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses account-scoped storage keys", () => {
    expect(jobHistorySearchHistoryKey("acct-a")).toBe("emr-eks:job-history-search-recent:acct-a");
  });

  it("returns empty history by default", () => {
    expect(readJobHistorySearchHistory("acct-a")).toEqual([]);
  });

  it("stores and reads recent searches per account", () => {
    rememberJobHistorySearch("acct-a", "alpha");
    rememberJobHistorySearch("acct-b", "beta");

    expect(readJobHistorySearchHistory("acct-a")).toEqual(["alpha"]);
    expect(readJobHistorySearchHistory("acct-b")).toEqual(["beta"]);
  });

  it("remembers searches most-recent first, capped at 10, deduped by normalized id", () => {
    rememberJobHistorySearch("acct-a", "alpha");
    rememberJobHistorySearch("acct-a", "spark-000000037tga8qam664");
    rememberJobHistorySearch("acct-a", "000000037tga8qam664");
    rememberJobHistorySearch("acct-a", "beta");

    const history = readJobHistorySearchHistory("acct-a");
    expect(history[0]).toBe("beta");
    expect(history[1]).toBe("000000037tga8qam664");
    expect(history).not.toContain("spark-000000037tga8qam664");
    expect(history).toContain("alpha");

    for (let i = 0; i < 12; i++) rememberJobHistorySearch("acct-a", `q${i}`);
    expect(readJobHistorySearchHistory("acct-a")).toHaveLength(JOB_HISTORY_SEARCH_HISTORY_LIMIT);
    expect(readJobHistorySearchHistory("acct-a")[0]).toBe("q11");
  });

  it("ignores blank queries", () => {
    rememberJobHistorySearch("acct-a", "   ");
    expect(readJobHistorySearchHistory("acct-a")).toEqual([]);
  });

  it("discards the legacy global history key without migrating", () => {
    window.localStorage.setItem(
      "emr-eks:job-history-search-recent",
      JSON.stringify(["legacy-query"])
    );

    expect(readJobHistorySearchHistory("acct-a")).toEqual([]);
    expect(window.localStorage.getItem("emr-eks:job-history-search-recent")).toBeNull();

    rememberJobHistorySearch("acct-a", "fresh");
    expect(readJobHistorySearchHistory("acct-a")).toEqual(["fresh"]);
    expect(window.localStorage.getItem("emr-eks:job-history-search-recent")).toBeNull();
  });
});
