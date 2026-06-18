import { describe, expect, it } from "vitest";
import { isAwsRegionFormat, normalizeAwsRegion } from "./awsRegions";

describe("awsRegions", () => {
  it("normalizes region codes to lowercase", () => {
    expect(normalizeAwsRegion(" EU-Central-1 ")).toBe("eu-central-1");
  });

  it("accepts common and custom AWS region formats", () => {
    expect(isAwsRegionFormat("eu-central-1")).toBe(true);
    expect(isAwsRegionFormat("ap-south-1")).toBe(true);
    expect(isAwsRegionFormat("us-gov-east-1")).toBe(true);
    expect(isAwsRegionFormat("not-a-region")).toBe(false);
  });
});
