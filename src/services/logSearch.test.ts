import { describe, expect, it } from "vitest";
import {
  buildSearchResult,
  formatSearchMatchLabel,
  MAX_LOG_SEARCH_MATCHES,
  selectRenderableMatches
} from "./logSearch";

describe("logSearch", () => {
  it("finds plain text matches case-insensitively", () => {
    const result = buildSearchResult("Needle one\nNEEDLE two", "needle", false);
    expect(result.matches).toEqual([
      { start: 0, end: 6 },
      { start: 11, end: 17 }
    ]);
  });

  it("supports regex search", () => {
    const result = buildSearchResult("needle one\nneedle two", "needle\\s+(one|two)", true);
    expect(result.matches).toHaveLength(2);
  });

  it("caps match collection for very large logs", () => {
    const text = "x".repeat(MAX_LOG_SEARCH_MATCHES + 50);
    const result = buildSearchResult(text, "x", false);
    expect(result.matches).toHaveLength(MAX_LOG_SEARCH_MATCHES);
    expect(result.truncated).toBe(true);
  });

  it("formats match labels with truncation and errors", () => {
    expect(formatSearchMatchLabel(0, 0)).toBe("0 / 0");
    expect(formatSearchMatchLabel(5, 2)).toBe("3 / 5");
    expect(formatSearchMatchLabel(1000, 0, { truncated: true })).toBe("1 / 1000+");
    expect(formatSearchMatchLabel(0, 0, { error: "Invalid regex" })).toBe("Invalid regex");
  });

  it("limits rendered highlights around the active match", () => {
    const matches = Array.from({ length: 100 }, (_, index) => ({
      start: index * 10,
      end: index * 10 + 1
    }));
    const selected = selectRenderableMatches(matches, 50);
    expect(selected.matches).toHaveLength(51);
    expect(selected.activeIndex).toBe(25);
  });
});
