import { describe, expect, it } from "vitest";
import { credentialSchema, editAccountSchema } from "./credentialValidation";

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

describe("editAccountSchema", () => {
  it("accepts name and region without a secret update", () => {
    const result = editAccountSchema.safeParse({
      name: "Prod",
      region: "eu-central-1",
      secretAccessKey: ""
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe("eu-central-1");
      expect(result.data.secretAccessKey).toBeUndefined();
    }
  });

  it("keeps a trimmed secret when provided", () => {
    const result = editAccountSchema.safeParse({
      name: "Prod",
      region: "us-east-1",
      secretAccessKey: "  new-secret  "
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.secretAccessKey).toBe("new-secret");
    }
  });

  it("rejects empty account names", () => {
    const result = editAccountSchema.safeParse({
      name: "   ",
      region: "us-east-1",
      secretAccessKey: ""
    });

    expect(result.success).toBe(false);
  });
});
