import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { describe, expect, it } from "vitest";
import {
  addExcludedRange,
  buildReplaceAllChanges,
  collectSearchMatches,
  findActiveMatchIndex,
  formatS3SearchMatchLabel,
  isRangeExcluded,
  MAX_S3_SEARCH_MATCHES
} from "./s3EditorSearch";

describe("s3EditorSearch", () => {
  it("collects plain-text matches and formats IDEA-style labels", () => {
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
    expect(formatS3SearchMatchLabel(matches.length, 1)).toBe("2/3");
    expect(formatS3SearchMatchLabel(0, 0)).toBe("0 Result");
  });

  it("returns invalid regex error label", () => {
    expect(formatS3SearchMatchLabel(0, 0, { error: "Invalid regex" })).toBe("Invalid regex");
  });

  it("marks truncated results at the match cap", () => {
    const repeated = "x ".repeat(MAX_S3_SEARCH_MATCHES + 5);
    const state = EditorState.create({ doc: repeated });
    const query = new SearchQuery({ search: "x" });
    const { matches, truncated } = collectSearchMatches(state, query);

    expect(truncated).toBe(true);
    expect(matches).toHaveLength(MAX_S3_SEARCH_MATCHES);
    expect(formatS3SearchMatchLabel(matches.length, 0, { truncated: true })).toBe(
      `1/${MAX_S3_SEARCH_MATCHES}+`
    );
  });

  it("skips excluded ranges when building replace-all changes", () => {
    const state = EditorState.create({ doc: "aa aa aa" });
    const query = new SearchQuery({ search: "aa", replace: "b" });
    const { matches } = collectSearchMatches(state, query);
    const excluded = addExcludedRange([], matches[1]!);

    expect(isRangeExcluded(excluded, matches[1]!)).toBe(true);
    expect(buildReplaceAllChanges(state, query, excluded)).toEqual([
      { from: 6, to: 8, insert: "b" },
      { from: 0, to: 2, insert: "b" }
    ]);
  });
});
