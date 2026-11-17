import { describe, expect, it } from "vitest";
import { credentialSchema, editAccountSchema } from "./credentialValidation";

describe("credentialSchema", () => {
  it("accepts custom AWS region codes and normalizes them", () => {
    const result = credentialSchema.safeParse({
      name: "Prod",
      authMethod: "accessKey",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      region: " AP-South-1 ",
      makeActive: true,
      ssoStartUrl: "",
      ssoRegion: "",
      ssoAccountId: "",
      ssoRoleName: "",
      mfaSerial: "",
      roleArn: "",
      externalId: "",
      roleSessionName: ""
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe("ap-south-1");
    }
  });

  it("rejects invalid region formats", () => {
    const result = credentialSchema.safeParse({
      name: "Prod",
      authMethod: "accessKey",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      region: "invalid",
      makeActive: true,
      ssoStartUrl: "",
      ssoRegion: "",
      ssoAccountId: "",
      ssoRoleName: "",
      mfaSerial: "",
      roleArn: "",
      externalId: "",
      roleSessionName: ""
    });

    expect(result.success).toBe(false);
  });
});

describe("editAccountSchema", () => {
  it("accepts region-only updates without unlocking credentials", () => {
    const result = editAccountSchema.safeParse({
      name: "Prod",
      authMethod: "accessKey",
      originalAuthMethod: "accessKey",
      region: "eu-central-1",
      accessKeyId: "",
      secretAccessKey: "",
      credentialsUnlocked: false,
      ssoStartUrl: "",
      ssoRegion: "",
      ssoAccountId: "",
      ssoRoleName: "",
      mfaSerial: "",
      roleArn: "",
      externalId: "",
      roleSessionName: ""
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe("eu-central-1");
      expect(result.data.secretAccessKey).toBeUndefined();
      expect(result.data.accessKeyId).toBeUndefined();
    }
  });

  it("keeps a trimmed key pair when credentials are unlocked", () => {
    const result = editAccountSchema.safeParse({
      name: "Prod",
      authMethod: "accessKey",
      originalAuthMethod: "accessKey",
      region: "us-east-1",
      accessKeyId: "  AKIANEW  ",
      secretAccessKey: "  new-secret  ",
      credentialsUnlocked: true,
      ssoStartUrl: "",
      ssoRegion: "",
      ssoAccountId: "",
      ssoRoleName: "",
      mfaSerial: "",
      roleArn: "",
      externalId: "",
      roleSessionName: ""
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accessKeyId).toBe("AKIANEW");
      expect(result.data.secretAccessKey).toBe("new-secret");
    }
  });

  it("requires credentials when switching away from SSO", () => {
    const result = editAccountSchema.safeParse({
      name: "Prod",
      authMethod: "accessKey",
      originalAuthMethod: "sso",
      region: "us-east-1",
      accessKeyId: "",
      secretAccessKey: "",
      credentialsUnlocked: true,
      ssoStartUrl: "",
      ssoRegion: "",
      ssoAccountId: "",
      ssoRoleName: "",
      mfaSerial: "",
      roleArn: "",
      externalId: "",
      roleSessionName: ""
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty account names", () => {
    const result = editAccountSchema.safeParse({
      name: "   ",
      authMethod: "accessKey",
      originalAuthMethod: "accessKey",
      region: "us-east-1",
      accessKeyId: "",
      secretAccessKey: "",
      credentialsUnlocked: false,
      ssoStartUrl: "",
      ssoRegion: "",
      ssoAccountId: "",
      ssoRoleName: "",
      mfaSerial: "",
      roleArn: "",
      externalId: "",
      roleSessionName: ""
    });

    expect(result.success).toBe(false);
  });
});
