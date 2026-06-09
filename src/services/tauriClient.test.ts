import { describe, expect, it, vi } from "vitest";
import { createTauriClient } from "./tauriClient";

describe("createTauriClient", () => {
  it("passes command names and payloads through a single invoke boundary", async () => {
    const invoke = vi.fn().mockResolvedValue([{ id: "vc-1", name: "prod" }]);
    const client = createTauriClient(invoke);

    const result = await client.listVirtualClusters({ region: "us-east-1" });

    expect(result).toEqual([{ id: "vc-1", name: "prod" }]);
    expect(invoke).toHaveBeenCalledWith("list_virtual_clusters", { request: { region: "us-east-1" } });
  });
});
