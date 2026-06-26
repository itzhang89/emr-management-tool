import { describe, expect, it } from "vitest";
import { hasSubmitUserSuffix, normalizeS3Path, resolveAthenaOutputLocation } from "./athenaOutputPath";

describe("athenaOutputPath", () => {
  it("normalizes paths to s3 scheme with trailing slash", () => {
    expect(normalizeS3Path("my-bucket/athena/")).toBe("s3://my-bucket/athena/");
  });

  it("appends submitUser when enabled", () => {
    expect(resolveAthenaOutputLocation("s3://bucket/results/", "john_doe", true)).toBe("s3://bucket/results/john_doe/");
  });

  it("does not duplicate submitUser suffix", () => {
    expect(resolveAthenaOutputLocation("s3://bucket/results/john_doe/", "john_doe", true)).toBe(
      "s3://bucket/results/john_doe/"
    );
  });

  it("detects existing submitUser suffix without trailing slash", () => {
    expect(hasSubmitUserSuffix("s3://bucket/results/john_doe", "john_doe")).toBe(true);
  });

  it("skips append when disabled", () => {
    expect(resolveAthenaOutputLocation("s3://bucket/results/", "john_doe", false)).toBe("s3://bucket/results/");
  });
});
