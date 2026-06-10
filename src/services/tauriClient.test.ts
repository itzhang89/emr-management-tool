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

  it("does not silently return production mock data outside Tauri", async () => {
    const client = createTauriClient();

    await expect(client.listVirtualClusters({ accountId: "acct-prod" })).rejects.toMatchObject({
      code: "DemoModeUnavailable"
    });
  });
});
