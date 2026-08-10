import { describe, expect, it } from "vitest";
import { computeLineChangeMarkers, diffLineOps, splitEditorLines } from "./s3EditorLineDiff";

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

  it("splits editor lines like CodeMirror trailing newlines", () => {
    expect(splitEditorLines("")).toEqual([""]);
    expect(splitEditorLines("a\nb\n")).toEqual(["a", "b", ""]);
    expect(diffLineOps(["a"], ["a", "b"]).map((op) => op.type)).toEqual(["equal", "insert"]);
  });
});
