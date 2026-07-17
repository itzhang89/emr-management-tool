import { describe, expect, it } from "vitest";
import { isValidUploadFileName, nextConflictFileName } from "./s3UploadConflict";

describe("s3UploadConflict", () => {
  it("suggests incrementing conflict file names", () => {
    expect(nextConflictFileName("report.csv")).toBe("report (1).csv");
    expect(nextConflictFileName("report (1).csv")).toBe("report (2).csv");
    expect(nextConflictFileName("archive")).toBe("archive (1)");
    expect(nextConflictFileName("archive (9)")).toBe("archive (10)");
  });

  it("validates upload file names", () => {
    expect(isValidUploadFileName("report.csv")).toBe(true);
    expect(isValidUploadFileName("  ")).toBe(false);
    expect(isValidUploadFileName("a/b.csv")).toBe(false);
    expect(isValidUploadFileName("a\\b.csv")).toBe(false);
    expect(isValidUploadFileName("..")).toBe(false);
  });
});
