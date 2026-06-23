import { describe, expect, it } from "vitest";
import { assertReleaseVersion, normalizeReleaseVersion } from "@/services/releaseVersion";

describe("release-version", () => {
  it("normalizes tags with or without a v prefix", () => {
    expect(normalizeReleaseVersion("v0.2.0")).toBe("0.2.0");
    expect(normalizeReleaseVersion("0.2.0")).toBe("0.2.0");
  });

  it("accepts semver tags used by git releases", () => {
    expect(assertReleaseVersion("v0.1.4", { label: "git tag" })).toBe("0.1.4");
    expect(assertReleaseVersion("0.1.42", { label: "release version" })).toBe("0.1.42");
  });

  it("rejects invalid release versions", () => {
    expect(() => assertReleaseVersion("vlatest", { label: "git tag" })).toThrow(/Invalid git tag/);
    expect(() => assertReleaseVersion("", { label: "RELEASE_VERSION" })).toThrow(/Invalid RELEASE_VERSION/);
  });
});
