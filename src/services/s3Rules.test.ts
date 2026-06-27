import { describe, expect, it } from "vitest";
import { getS3ObjectEditability } from "./s3Rules";

describe("getS3ObjectEditability", () => {
  it("allows documented text extensions", () => {
    expect(getS3ObjectEditability({ key: "jobs/query.sql", size: 1024 })).toEqual({
      editable: true,
      previewable: true,
      reason: undefined
    });
    expect(getS3ObjectEditability({ key: "src/Main.scala", size: 1024 })).toEqual({
      editable: true,
      previewable: true,
      reason: undefined
    });
    expect(getS3ObjectEditability({ key: "src/Lib.sc", size: 1024 })).toEqual({
      editable: true,
      previewable: true,
      reason: undefined
    });
  });

  it("keeps binary and archive extensions read-only", () => {
    expect(getS3ObjectEditability({ key: "jars/app.jar", size: 1024 })).toMatchObject({
      editable: false,
      previewable: false
    });
  });

  it("prevents editing large text files while allowing preview", () => {
    expect(getS3ObjectEditability({ key: "logs/app.txt", size: 6 * 1024 * 1024 })).toEqual({
      editable: false,
      previewable: true,
      reason: "File is larger than the 5 MB editor limit."
    });
  });
});
