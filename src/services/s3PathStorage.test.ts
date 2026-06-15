import { beforeEach, describe, expect, it } from "vitest";
import { readLastS3Path, s3PathStorageKey, writeLastS3Path } from "./s3PathStorage";

describe("s3PathStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses account-scoped storage keys", () => {
    expect(s3PathStorageKey("acct-a")).toBe("emr-eks:last-s3-path:acct-a");
  });

  it("stores and reads the last S3 path per account", () => {
    writeLastS3Path("acct-a", "bucket-a", "logs/");
    writeLastS3Path("acct-b", "bucket-b", "data/");

    expect(readLastS3Path("acct-a")).toEqual({ bucket: "bucket-a", prefix: "logs/" });
    expect(readLastS3Path("acct-b")).toEqual({ bucket: "bucket-b", prefix: "data/" });
  });

  it("migrates the legacy global S3 path key to the active account", () => {
    localStorage.setItem("emr-eks:last-s3-path", JSON.stringify({ bucket: "legacy-bucket", prefix: "legacy/" }));

    expect(readLastS3Path("acct-a")).toEqual({ bucket: "legacy-bucket", prefix: "legacy/" });
    expect(localStorage.getItem("emr-eks:last-s3-path")).toBeNull();
    expect(localStorage.getItem("emr-eks:last-s3-path:acct-a")).toContain("legacy-bucket");
  });
});
