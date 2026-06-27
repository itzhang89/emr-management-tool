import { describe, expect, it } from "vitest";
import {
  appendSlashForMatching,
  buildBrowseListItems,
  buildBucketSuggestions,
  buildFolderSuggestions,
  parsePathInputForSuggestions,
  resolvePathInputEnterAction
} from "./s3PathUtils";

describe("appendSlashForMatching", () => {
  it("appends a trailing slash for continued matching", () => {
    expect(appendSlashForMatching("data-bucket")).toBe("data-bucket/");
    expect(appendSlashForMatching("data-bucket/logs")).toBe("data-bucket/logs/");
    expect(appendSlashForMatching("s3://data-bucket/logs/ar")).toBe("data-bucket/logs/ar/");
  });

  it("leaves paths that already end with a slash unchanged", () => {
    expect(appendSlashForMatching("data-bucket/")).toBe("data-bucket/");
    expect(appendSlashForMatching("data-bucket/logs/")).toBe("data-bucket/logs/");
  });
});
describe("resolvePathInputEnterAction", () => {
  it("selects when there is exactly one suggestion", () => {
    expect(resolvePathInputEnterAction("data", 1)).toBe("select-suggestion");
  });

  it("does nothing when there are multiple suggestions", () => {
    expect(resolvePathInputEnterAction("data-bucket/lo", 2)).toBe("noop");
    expect(resolvePathInputEnterAction("data", 3)).toBe("noop");
  });

  it("navigates only when the path already ends with a slash and there are no suggestions", () => {
    expect(resolvePathInputEnterAction("data-bucket/", 0)).toBe("navigate");
    expect(resolvePathInputEnterAction("data-bucket/logs/", 0)).toBe("navigate");
  });

  it("does not append a slash for partial input without a unique match", () => {
    expect(resolvePathInputEnterAction("data-bucket", 0)).toBe("noop");
    expect(resolvePathInputEnterAction("data-bucket/lo", 0)).toBe("noop");
  });
});
describe("parsePathInputForSuggestions", () => {
  it("treats input without a slash as bucket selection", () => {
    expect(parsePathInputForSuggestions("data")).toEqual({ mode: "bucket", needle: "data" });
    expect(parsePathInputForSuggestions("s3://logs-bucket")).toEqual({ mode: "bucket", needle: "logs-bucket" });
  });

  it("treats bucket root as folder selection", () => {
    expect(parsePathInputForSuggestions("data-bucket/")).toEqual({
      mode: "folder",
      bucket: "data-bucket",
      parentPrefix: "",
      needle: ""
    });
  });

  it("matches only the next folder segment after the bucket", () => {
    expect(parsePathInputForSuggestions("data-bucket/lo")).toEqual({
      mode: "folder",
      bucket: "data-bucket",
      parentPrefix: "",
      needle: "lo"
    });
    expect(parsePathInputForSuggestions("data-bucket/logs/ar")).toEqual({
      mode: "folder",
      bucket: "data-bucket",
      parentPrefix: "logs/",
      needle: "ar"
    });
  });
});

describe("buildBucketSuggestions", () => {
  const bucketNames = ["data-bucket", "logs-bucket", "archive-data"];

  it("returns bucket options with prefix matching only", () => {
    expect(buildBucketSuggestions(bucketNames, "data")).toEqual(["data-bucket/"]);
    expect(buildBucketSuggestions(bucketNames, "logs")).toEqual(["logs-bucket/"]);
    expect(buildBucketSuggestions(bucketNames, "bucket")).toEqual([]);
  });
});

describe("buildFolderSuggestions", () => {
  const objects = [
    { key: "logs/", kind: "folder" as const },
    { key: "logs/archive/", kind: "folder" as const },
    { key: "logs/artifacts/", kind: "folder" as const },
    { key: "logs/archive/2024/", kind: "folder" as const },
    { key: "data/", kind: "folder" as const }
  ];

  it("lists only the next level under the current prefix", () => {
    expect(buildFolderSuggestions("data-bucket", "", objects, "")).toEqual([
      "data-bucket/data/",
      "data-bucket/logs/"
    ]);
    expect(buildFolderSuggestions("data-bucket", "logs/", objects, "")).toEqual([
      "data-bucket/logs/archive/",
      "data-bucket/logs/artifacts/"
    ]);
  });

  it("filters the next level by prefix only", () => {
    expect(buildFolderSuggestions("data-bucket", "", objects, "lo")).toEqual(["data-bucket/logs/"]);
    expect(buildFolderSuggestions("data-bucket", "logs/", objects, "ar")).toEqual([
      "data-bucket/logs/archive/",
      "data-bucket/logs/artifacts/"
    ]);
  });
});

describe("buildBrowseListItems", () => {
  const bucketNames = ["data-bucket", "logs-bucket", "archive-data"];
  const objects = [
    { key: "logs/", kind: "folder" as const },
    { key: "lost/", kind: "folder" as const },
    { key: "data/", kind: "folder" as const },
    { key: "logs/archive/", kind: "folder" as const }
  ];

  it("filters matching buckets while typing", () => {
    expect(buildBrowseListItems({ mode: "bucket", needle: "data" }, bucketNames, [])).toEqual([
      {
        type: "bucket",
        name: "data-bucket",
        pathInput: "data-bucket/",
        label: "data-bucket/"
      }
    ]);
  });

  it("filters matching folders at the next level while typing", () => {
    expect(
      buildBrowseListItems(
        { mode: "folder", bucket: "data-bucket", parentPrefix: "", needle: "lo" },
        bucketNames,
        objects
      )
    ).toEqual([
      {
        type: "folder",
        bucket: "data-bucket",
        key: "logs/",
        pathInput: "data-bucket/logs/",
        label: "logs/"
      },
      {
        type: "folder",
        bucket: "data-bucket",
        key: "lost/",
        pathInput: "data-bucket/lost/",
        label: "lost/"
      }
    ]);
  });
});
