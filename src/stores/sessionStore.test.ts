import { describe, expect, it } from "vitest";
import { useSessionStore } from "./sessionStore";

describe("useSessionStore", () => {
  it("tracks selected region and virtual cluster", () => {
    useSessionStore.getState().setRegion("us-west-2");
    useSessionStore.getState().setSelectedVirtualClusterId("vc-prod");

    expect(useSessionStore.getState().region).toBe("us-west-2");
    expect(useSessionStore.getState().selectedVirtualClusterId).toBe("vc-prod");
  });
});
