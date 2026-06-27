import { describe, expect, it } from "vitest";
import {
  appendSlashForMatching,
  formatCompactS3Path,
  listS3PathOptions,
  listS3PathSuggestions,
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

describe("listS3PathOptions", () => {
  const bucketNames = ["data-bucket", "logs-bucket", "archive-data"];
  const objects = [
    { key: "logs/", kind: "folder" as const },
    { key: "lost/", kind: "folder" as const },
    { key: "data/", kind: "folder" as const },
    { key: "logs/archive/", kind: "folder" as const },
    { key: "logs/artifacts/", kind: "folder" as const },
    { key: "logs/archive/2024/", kind: "folder" as const }
  ];

  it("returns bucket options with prefix matching only", () => {
    expect(listS3PathOptions({ mode: "bucket", needle: "data" }, bucketNames, [])).toEqual([
      {
        type: "bucket",
        name: "data-bucket",
        pathInput: "data-bucket/",
        label: "data-bucket/"
      }
    ]);
    expect(listS3PathOptions({ mode: "bucket", needle: "logs" }, bucketNames, []).map((option) => option.pathInput)).toEqual([
      "logs-bucket/"
    ]);
    expect(listS3PathOptions({ mode: "bucket", needle: "bucket" }, bucketNames, [])).toEqual([]);
  });

  it("lists only the next level under the current prefix", () => {
    expect(
      listS3PathOptions({ mode: "folder", bucket: "data-bucket", parentPrefix: "", needle: "" }, bucketNames, objects).map(
        (option) => option.pathInput
      )
    ).toEqual(["data-bucket/data/", "data-bucket/logs/", "data-bucket/lost/"]);
    expect(
      listS3PathOptions(
        { mode: "folder", bucket: "data-bucket", parentPrefix: "logs/", needle: "" },
        bucketNames,
        objects
      ).map((option) => option.pathInput)
    ).toEqual(["data-bucket/logs/archive/", "data-bucket/logs/artifacts/"]);
  });

  it("filters the next level by prefix only", () => {
    expect(
      listS3PathOptions({ mode: "folder", bucket: "data-bucket", parentPrefix: "", needle: "lo" }, bucketNames, objects).map(
        (option) => option.pathInput
      )
    ).toEqual(["data-bucket/logs/", "data-bucket/lost/"]);
    expect(
      listS3PathOptions(
        { mode: "folder", bucket: "data-bucket", parentPrefix: "logs/", needle: "ar" },
        bucketNames,
        objects
      ).map((option) => option.pathInput)
    ).toEqual(["data-bucket/logs/archive/", "data-bucket/logs/artifacts/"]);
  });
});

describe("listS3PathSuggestions", () => {
  it("limits dropdown suggestions while keeping browse options complete", () => {
    const options = listS3PathOptions({ mode: "bucket", needle: "" }, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"], []);
    expect(listS3PathSuggestions(options, 12)).toHaveLength(12);
    expect(options).toHaveLength(13);
  });
});

describe("formatCompactS3Path", () => {
  it("collapses long prefixes for display", () => {
    expect(formatCompactS3Path("bucket", "a/b/c/d/")).toBe("s3://bucket/.../c/d/");
    expect(formatCompactS3Path(undefined, "a/")).toBe("s3://");
  });
});

describe("validateS3FolderName", () => {
  it("rejects empty and invalid folder names", async () => {
    const { validateS3FolderName, buildFolderKey } = await import("./s3PathUtils");
    expect(validateS3FolderName("")).toBe("Folder name is required.");
    expect(validateS3FolderName("bad/name")).toBe("Folder name cannot contain '/'.");
    expect(buildFolderKey("logs/", "reports")).toBe("logs/reports/");
  });
});
