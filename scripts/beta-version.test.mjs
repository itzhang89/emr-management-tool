import { describe, expect, it } from "vitest";
import { deriveNextBeta } from "./beta-version.mjs";

describe("deriveNextBeta", () => {
  it("starts at beta1 for the patch after the newest stable", () => {
    expect(deriveNextBeta({ stableTag: "v0.2.1", tags: ["v0.2.0", "v0.2.1"] })).toMatchObject({
      tag: "v0.2.2-beta1",
      version: "0.2.2-beta1",
      name: "EMR Management Tool v0.2.2 Beta 1",
      beta: 1
    });
  });

  it("increments past the betas that already exist", () => {
    expect(
      deriveNextBeta({
        stableTag: "v0.2.1",
        tags: ["v0.2.1", "v0.2.2-beta1", "v0.2.2-beta2"]
      }).tag
    ).toBe("v0.2.2-beta3");
  });

  it("orders beta ordinals numerically, not lexically", () => {
    expect(
      deriveNextBeta({
        stableTag: "v0.2.1",
        tags: ["v0.2.2-beta1", "v0.2.2-beta9"]
      }).tag
    ).toBe("v0.2.2-beta10");
  });

  it("restarts from the new patch once a stable release lands", () => {
    expect(
      deriveNextBeta({
        stableTag: "v0.2.2",
        tags: ["v0.2.1", "v0.2.2", "v0.2.2-beta1", "v0.2.2-beta2"]
      }).tag
    ).toBe("v0.2.3-beta1");
  });

  it("follows a stray higher beta instead of regressing below it", () => {
    expect(
      deriveNextBeta({ stableTag: "v0.2.1", tags: ["v0.2.3-beta1"] }).tag
    ).toBe("v0.2.3-beta2");
  });

  it("ignores prerelease tags that are not betas of this line", () => {
    expect(
      deriveNextBeta({
        stableTag: "v0.2.1",
        tags: ["v0.2.1-rc1", "stable-channel", "development-build-41"]
      }).tag
    ).toBe("v0.2.2-beta1");
  });

  it("accepts a stable tag without the v prefix", () => {
    expect(deriveNextBeta({ stableTag: "0.2.1", tags: [] }).tag).toBe("v0.2.2-beta1");
  });

  it("fails loudly when there is no stable release to build on", () => {
    expect(() => deriveNextBeta({ stableTag: null, tags: [] })).toThrow(/No stable release tag/);
    expect(() => deriveNextBeta({ stableTag: "stable-channel", tags: [] })).toThrow(
      /No stable release tag/
    );
  });
});
