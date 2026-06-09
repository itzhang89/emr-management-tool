import { describe, expect, it } from "vitest";
import { credentialSchema } from "./credentialValidation";

describe("credentialSchema", () => {
  it("accepts access-key credentials with a region", () => {
    expect(
      credentialSchema.parse({
        accessKeyId: "AKIA1234567890",
        secretAccessKey: "secret",
        region: "us-east-1"
      })
    ).toEqual({
      accessKeyId: "AKIA1234567890",
      secretAccessKey: "secret",
      region: "us-east-1"
    });
  });

  it("rejects missing secret access keys", () => {
    expect(() =>
      credentialSchema.parse({
        accessKeyId: "AKIA1234567890",
        secretAccessKey: "",
        region: "us-east-1"
      })
    ).toThrow();
  });
});
