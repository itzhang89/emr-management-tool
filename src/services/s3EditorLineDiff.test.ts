import { describe, expect, it } from "vitest";
import { computeLineChangeMarkers, splitEditorLines } from "./s3EditorLineDiff";

describe("s3EditorLineDiff", () => {
  it("returns no markers when texts match", () => {
    expect(computeLineChangeMarkers("a\nb", "a\nb")).toEqual([]);
  });

  it("marks added and modified lines", () => {
    expect(computeLineChangeMarkers("one\ntwo\nthree", "one\nTWO\nthree\nfour")).toEqual([
      { line: 2, kind: "modified" },
      { line: 4, kind: "added" }
    ]);
  });

  it("marks deleted-before when lines are removed", () => {
    expect(computeLineChangeMarkers("a\nb\nc", "a\nc")).toEqual([
      { line: 2, kind: "deleted-before" }
    ]);
  });

  it("places Enter-inserted blank lines after the previous content line", () => {
    // Baseline has two blanks between content; pressing Enter after 内容1 inserts
    // at the start of that blank run — not on the blank next to 内容2.
    expect(computeLineChangeMarkers("内容1\n\n\n内容2", "内容1\n\n\n\n内容2")).toEqual([
      { line: 2, kind: "added" }
    ]);
    expect(computeLineChangeMarkers("内容1\n\n内容2", "内容1\n\n\n内容2")).toEqual([
      { line: 2, kind: "added" }
    ]);
  });

  it("splits editor lines like CodeMirror trailing newlines", () => {
    expect(splitEditorLines("")).toEqual([""]);
    expect(splitEditorLines("a\nb\n")).toEqual(["a", "b", ""]);
  });
});
