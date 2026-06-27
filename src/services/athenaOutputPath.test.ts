import { describe, expect, it } from "vitest";
import {
  displayAthenaResultsPath,
  hasSubmitUserSuffix,
  isAthenaManagedResultsWorkgroup,
  isAthenaOutputPathRequired,
  normalizeS3Path,
  resolveAthenaOutputLocation,
  resolveAthenaQueryOutputLocation
} from "./athenaOutputPath";

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

  it("does not require output path for managed results workgroups", () => {
    expect(isAthenaOutputPathRequired({ managedResultsEnabled: true }, "")).toBe(false);
  });

  it("uses workgroup output when client path is empty", () => {
    expect(
      isAthenaOutputPathRequired({ outputLocation: "s3://bucket/workgroup-results/" }, "")
    ).toBe(false);
  });

  it("sends client path when configured", () => {
    const path = "s3://bucket/results/user/";
    expect(resolveAthenaQueryOutputLocation(path)).toBe(path);
  });

  it("returns undefined when path is empty", () => {
    expect(resolveAthenaQueryOutputLocation("")).toBeUndefined();
  });

  it("detects managed results workgroups", () => {
    expect(isAthenaManagedResultsWorkgroup({ managedResultsEnabled: true })).toBe(true);
    expect(isAthenaManagedResultsWorkgroup({ managedResultsEnabled: false })).toBe(false);
  });

  it("displays user S3 path in the query bar", () => {
    expect(displayAthenaResultsPath({}, "s3://bucket/custom/")).toBe("s3://bucket/custom/");
  });
});
