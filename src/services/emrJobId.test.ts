import { describe, expect, it } from "vitest";
import { isLikelyEmrJobRunId } from "./emrJobId";

describe("isLikelyEmrJobRunId", () => {
  it("accepts EMR-style job ids", () => {
    expect(isLikelyEmrJobRunId("job-abc123")).toBe(true);
    expect(isLikelyEmrJobRunId("0123456789abcdef")).toBe(true);
  });

  it("rejects generic search terms", () => {
    expect(isLikelyEmrJobRunId("failed")).toBe(false);
    expect(isLikelyEmrJobRunId("")).toBe(false);
  });
});
