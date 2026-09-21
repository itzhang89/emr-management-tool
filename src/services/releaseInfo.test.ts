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

  it("labels beta builds and lets them update in place", () => {
    const info = createReleaseInfo({ appChannel: "beta", platform: "darwin", version: "0.2.2-beta1" });

    expect(info.appChannel).toBe("beta");
    expect(info.channelLabel).toBe("Beta");
    expect(info.isDevelopment).toBe(false);
    // A beta package carries the stable identity, so it updates like stable does.
    expect(info.canUseAutoUpdater).toBe(true);
    expect(info.version).toBe("0.2.2-beta1");
  });

  it("normalizes unknown channel names to stable", () => {
    expect(createReleaseInfo({ appChannel: "test" }).appChannel).toBe("stable");
  });

  it("includes the app version with a development fallback", () => {
    expect(createReleaseInfo({ version: "0.2.0" }).version).toBe("0.2.0");
    expect(createReleaseInfo().version).toBe("0.0.0-dev");
  });

  it("exposes portable distribution and updater eligibility", () => {
    const portable = createReleaseInfo({
      appChannel: "stable",
      platform: "windows",
      distribution: "portable"
    });
    expect(portable.distribution).toBe("portable");
    expect(portable.isPortable).toBe(true);
    expect(portable.canUseAutoUpdater).toBe(true);

    expect(
      createReleaseInfo({
        appChannel: "development",
        platform: "windows",
        distribution: "portable"
      }).canUseAutoUpdater
    ).toBe(false);

    expect(
      createReleaseInfo({
        appChannel: "stable",
        platform: "windows",
        distribution: "installer"
      }).canUseAutoUpdater
    ).toBe(true);
  });
});
