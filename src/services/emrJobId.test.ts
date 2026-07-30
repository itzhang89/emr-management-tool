import { describe, expect, it } from "vitest";
import { isLikelyEmrJobRunId, normalizeEmrJobRunId } from "./emrJobId";

describe("normalizeEmrJobRunId", () => {
  it("strips a spark- prefix case-insensitively", () => {
    expect(normalizeEmrJobRunId("spark-000000037tga8qam664")).toBe("000000037tga8qam664");
    expect(normalizeEmrJobRunId("SPARK-000000037tga8qam664")).toBe("000000037tga8qam664");
  });

  it("trims whitespace and leaves non-spark ids unchanged", () => {
    expect(normalizeEmrJobRunId("  job-abc123  ")).toBe("job-abc123");
    expect(normalizeEmrJobRunId("failed")).toBe("failed");
  });
});

describe("isLikelyEmrJobRunId", () => {
  it("accepts EMR-style job ids", () => {
    expect(isLikelyEmrJobRunId("job-abc123")).toBe(true);
    expect(isLikelyEmrJobRunId("0123456789abcdef")).toBe(true);
  });

  it("accepts spark-prefixed application ids", () => {
    expect(isLikelyEmrJobRunId("spark-000000037tga8qam664")).toBe(true);
  });

  it("rejects generic search terms", () => {
    expect(isLikelyEmrJobRunId("failed")).toBe(false);
    expect(isLikelyEmrJobRunId("")).toBe(false);
  });
});
