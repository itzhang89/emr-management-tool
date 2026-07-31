import { beforeEach, describe, expect, it } from "vitest";
import { RECENT_SEARCH_HISTORY_LIMIT, readRecentSearchHistory, rememberRecentSearch } from "./recentSearchHistory";

const storageKey = "emr-eks:test-recent-search";

describe("recentSearchHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns empty history by default", () => {
    expect(readRecentSearchHistory(storageKey)).toEqual([]);
  });

  it("remembers searches most-recent first, capped at 10, deduped by normalized id", () => {
    rememberRecentSearch(storageKey, "alpha");
    rememberRecentSearch(storageKey, "spark-000000037tga8qam664");
    rememberRecentSearch(storageKey, "000000037tga8qam664");
    rememberRecentSearch(storageKey, "beta");

    const history = readRecentSearchHistory(storageKey);
    expect(history[0]).toBe("beta");
    expect(history[1]).toBe("000000037tga8qam664");
    expect(history).not.toContain("spark-000000037tga8qam664");
    expect(history).toContain("alpha");

    for (let i = 0; i < 12; i++) rememberRecentSearch(storageKey, `q${i}`);
    expect(readRecentSearchHistory(storageKey)).toHaveLength(RECENT_SEARCH_HISTORY_LIMIT);
    expect(readRecentSearchHistory(storageKey)[0]).toBe("q11");
  });

  it("ignores blank queries", () => {
    rememberRecentSearch(storageKey, "   ");
    expect(readRecentSearchHistory(storageKey)).toEqual([]);
  });

  it("keeps separate storage keys independent", () => {
    rememberRecentSearch("key-a", "alpha");
    rememberRecentSearch("key-b", "beta");
    expect(readRecentSearchHistory("key-a")).toEqual(["alpha"]);
    expect(readRecentSearchHistory("key-b")).toEqual(["beta"]);
  });
});
