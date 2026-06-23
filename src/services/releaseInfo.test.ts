import { describe, expect, it } from "vitest";
import { createReleaseInfo } from "./releaseInfo";

describe("createReleaseInfo", () => {
  it("marks development builds with a separate channel label", () => {
    const info = createReleaseInfo({ appChannel: "development", platform: "darwin" });

    expect(info.isDevelopment).toBe(true);
    expect(info.channelLabel).toBe("Development");
    expect(info.canUseAutoUpdater).toBe(false);
  });

  it("enables the stable updater for Windows and macOS stable builds", () => {
    expect(createReleaseInfo({ appChannel: "stable", platform: "windows" }).canUseAutoUpdater).toBe(true);
    expect(createReleaseInfo({ appChannel: "stable", platform: "darwin" }).canUseAutoUpdater).toBe(true);
  });

  it("keeps development and non-desktop platforms out of the automatic updater", () => {
    expect(createReleaseInfo({ appChannel: "development", platform: "darwin" }).canUseAutoUpdater).toBe(false);
    expect(createReleaseInfo({ appChannel: "stable", platform: "linux" }).canUseAutoUpdater).toBe(false);
  });

  it("normalizes unknown channel names to stable", () => {
    expect(createReleaseInfo({ appChannel: "test" }).appChannel).toBe("stable");
  });

  it("includes the app version with a development fallback", () => {
    expect(createReleaseInfo({ version: "0.2.0" }).version).toBe("0.2.0");
    expect(createReleaseInfo().version).toBe("0.0.0-dev");
  });
});
