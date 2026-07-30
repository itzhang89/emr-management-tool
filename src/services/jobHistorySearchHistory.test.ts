import { beforeEach, describe, expect, it } from "vitest";
import {
  JOB_HISTORY_SEARCH_HISTORY_LIMIT,
  readJobHistorySearchHistory,
  rememberJobHistorySearch
} from "./jobHistorySearchHistory";

describe("jobHistorySearchHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns empty history by default", () => {
    expect(readJobHistorySearchHistory()).toEqual([]);
  });

  it("remembers searches most-recent first, capped at 10, deduped by normalized id", () => {
    rememberJobHistorySearch("alpha");
    rememberJobHistorySearch("spark-000000037tga8qam664");
    rememberJobHistorySearch("000000037tga8qam664");
    rememberJobHistorySearch("beta");

    const history = readJobHistorySearchHistory();
    expect(history[0]).toBe("beta");
    expect(history[1]).toBe("000000037tga8qam664");
    expect(history).not.toContain("spark-000000037tga8qam664");
    expect(history).toContain("alpha");

    for (let i = 0; i < 12; i++) rememberJobHistorySearch(`q${i}`);
    expect(readJobHistorySearchHistory()).toHaveLength(JOB_HISTORY_SEARCH_HISTORY_LIMIT);
    expect(readJobHistorySearchHistory()[0]).toBe("q11");
  });

  it("ignores blank queries", () => {
    rememberJobHistorySearch("   ");
    expect(readJobHistorySearchHistory()).toEqual([]);
  });
});
