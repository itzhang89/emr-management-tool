import { describe, expect, it, vi } from "vitest";
import { createTauriClient } from "./tauriClient";

describe("createTauriClient", () => {
  it("passes command names and payloads through a single invoke boundary", async () => {
    const invoke = vi.fn().mockResolvedValue({ clusters: [{ id: "vc-1", name: "prod" }] });
    const client = createTauriClient(invoke);

    const result = await client.listVirtualClusters({ accountId: "acct-prod" });

    expect(result).toEqual({ clusters: [{ id: "vc-1", name: "prod" }] });
    expect(invoke).toHaveBeenCalledWith("list_virtual_clusters", { request: { accountId: "acct-prod" } });
  });

  it("lists importable AWS CLI profiles without exposing secrets", async () => {
    const profiles = [{ profileName: "dev", region: "us-east-1", accessKeyIdMasked: "AKIA****1234", canImport: true }];
    const invoke = vi.fn().mockResolvedValue(profiles);
    const client = createTauriClient(invoke);

    const result = await client.listAwsCliProfiles();

    expect(result).toEqual(profiles);
    expect(result[0]).not.toHaveProperty("secretAccessKey");
    expect(invoke).toHaveBeenCalledWith("list_aws_cli_profiles", undefined);
  });

  it("imports an AWS CLI profile by name without returning secrets to the frontend", async () => {
    const account = {
      id: "aws-profile-dev",
      name: "dev",
      region: "us-east-1",
      accessKeyIdMasked: "AKIA****1234",
      isActive: true
    };
    const invoke = vi.fn().mockResolvedValue(account);
    const client = createTauriClient(invoke);

    const result = await client.importAwsCliProfile({ profileName: "dev", makeActive: true });

    expect(result).toEqual(account);
    expect(result).not.toHaveProperty("secretAccessKey");
    expect(invoke).toHaveBeenCalledWith("import_aws_cli_profile", {
      request: { profileName: "dev", makeActive: true }
    });
  });

  it("does not silently return production mock data outside Tauri", async () => {
    const client = createTauriClient();

    await expect(client.listVirtualClusters({ accountId: "acct-prod" })).rejects.toMatchObject({
      code: "DemoModeUnavailable"
    });
  });
});
