import { describe, expect, it } from "vitest";
import { credentialSchema } from "./credentialValidation";

describe("credentialSchema", () => {
  it("accepts custom AWS region codes and normalizes them", () => {
    const result = credentialSchema.safeParse({
      name: "Prod",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      region: " AP-South-1 ",
      makeActive: true
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe("ap-south-1");
    }
  });

  it("rejects invalid region formats", () => {
    const result = credentialSchema.safeParse({
      name: "Prod",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      region: "invalid",
      makeActive: true
    });

    expect(result.success).toBe(false);
  });
});
