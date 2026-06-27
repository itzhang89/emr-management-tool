import { describe, expect, it } from "vitest";
import { isAthenaOutputPathError } from "./athenaOutputPathErrors";

describe("isAthenaOutputPathError", () => {
  it("detects common Athena output location failures", () => {
    expect(isAthenaOutputPathError("The S3 location provided for query result location is invalid")).toBe(true);
    expect(isAthenaOutputPathError("Unable to verify/create output bucket my-athena-results")).toBe(true);
    expect(isAthenaOutputPathError("SELECT syntax error near FROM")).toBe(false);
  });
});
