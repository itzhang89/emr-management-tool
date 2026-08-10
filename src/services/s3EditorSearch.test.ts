import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { describe, expect, it } from "vitest";
import {
  collectSearchMatches,
  findActiveMatchIndex,
  formatS3SearchMatchLabel,
  MAX_S3_SEARCH_MATCHES
} from "./s3EditorSearch";

describe("s3EditorSearch", () => {
  it("collects plain-text matches and reports active index", () => {
    const state = EditorState.create({ doc: "alpha beta alpha gamma alpha" });
    const query = new SearchQuery({ search: "alpha" });
    const { matches, truncated } = collectSearchMatches(state, query);

    expect(truncated).toBe(false);
    expect(matches).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
      { from: 23, to: 28 }
    ]);
    expect(findActiveMatchIndex(matches, 11, 16)).toBe(1);
    expect(formatS3SearchMatchLabel(matches.length, 1)).toBe("2 / 3");
  });

  it("returns empty label for empty query and invalid regex error", () => {
    expect(formatS3SearchMatchLabel(0, 0, { emptyQuery: true })).toBe("");
    expect(formatS3SearchMatchLabel(0, 0, { error: "Invalid regex" })).toBe("Invalid regex");
    expect(formatS3SearchMatchLabel(0, 0)).toBe("0 results");
  });

  it("marks truncated results at the match cap", () => {
    const repeated = "x ".repeat(MAX_S3_SEARCH_MATCHES + 5);
    const state = EditorState.create({ doc: repeated });
    const query = new SearchQuery({ search: "x" });
    const { matches, truncated } = collectSearchMatches(state, query);

    expect(truncated).toBe(true);
    expect(matches).toHaveLength(MAX_S3_SEARCH_MATCHES);
    expect(formatS3SearchMatchLabel(matches.length, 0, { truncated: true })).toBe(
      `1 / ${MAX_S3_SEARCH_MATCHES}+`
    );
  });
});
