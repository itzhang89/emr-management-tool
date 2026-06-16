import { describe, expect, it } from "vitest";
import { createReleaseInfo } from "./releaseInfo";

describe("createReleaseInfo", () => {
  it("marks development builds with a separate channel label", () => {
    const info = createReleaseInfo({ appChannel: "development", platform: "darwin" });

    expect(info.isDevelopment).toBe(true);
    expect(info.channelLabel).toBe("Development");
    expect(info.canUseAutoUpdater).toBe(false);
  });

  it("enables the stable updater only for Windows stable builds", () => {
    const info = createReleaseInfo({ appChannel: "stable", platform: "windows" });

    expect(info.isDevelopment).toBe(false);
    expect(info.channelLabel).toBe("Stable");
    expect(info.canUseAutoUpdater).toBe(true);
  });

  it("keeps unsigned macOS stable builds out of the automatic updater", () => {
    const info = createReleaseInfo({ appChannel: "stable", platform: "darwin" });

    expect(info.canUseAutoUpdater).toBe(false);
  });

  it("normalizes unknown channel names to stable", () => {
    expect(createReleaseInfo({ appChannel: "test" }).appChannel).toBe("stable");
  });
});
