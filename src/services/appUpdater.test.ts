import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppUpdater } from "./appUpdater";

describe("createAppUpdater", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns unavailable when the current build should not use the automatic updater", async () => {
    const check = vi.fn();
    const updater = createAppUpdater({
      canUseAutoUpdater: false,
      check
    });

    await expect(updater.checkForUpdate()).resolves.toEqual({
      status: "unavailable",
      reason: "Automatic updates are available only for stable Windows and macOS builds."
    });
    expect(check).not.toHaveBeenCalled();
  });

  it("reports no-update when the Tauri updater returns null", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const updater = createAppUpdater({
      canUseAutoUpdater: true,
      check
    });

    await expect(updater.checkForUpdate()).resolves.toEqual({ status: "no-update" });
  });

  it("downloads and installs the returned update", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const check = vi.fn().mockResolvedValue({
      version: "0.2.0",
      body: "Bug fixes",
      downloadAndInstall
    });
    const updater = createAppUpdater({
      canUseAutoUpdater: true,
      check
    });

    const update = await updater.checkForUpdate();
    expect(update).toMatchObject({ status: "available", version: "0.2.0", notes: "Bug fixes" });

    if (update.status !== "available") {
      throw new Error("Expected an available update");
    }

    await update.install();

    expect(downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("silently skips when auto updater is unavailable", async () => {
    const check = vi.fn();
    const updater = createAppUpdater({
      canUseAutoUpdater: false,
      check
    });
    await expect(updater.checkAndInstallSilently()).resolves.toBe("skipped");
    expect(check).not.toHaveBeenCalled();
  });

  it("times out only the check call after 60s and stays silent", async () => {
    vi.useFakeTimers();
    const check = vi.fn((): Promise<null> => new Promise(() => {}));
    const updater = createAppUpdater({
      canUseAutoUpdater: true,
      check
    });
    const pending = updater.checkAndInstallSilently();
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toBe("failed");
  });

  it("installs available updates and reports installed without toasting itself", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const check = vi.fn().mockResolvedValue({
      version: "0.2.0",
      downloadAndInstall
    });
    const onInstalled = vi.fn();
    const updater = createAppUpdater({
      canUseAutoUpdater: true,
      check
    });
    await expect(updater.checkAndInstallSilently({ onInstalled })).resolves.toBe("installed");
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(onInstalled).toHaveBeenCalledWith("0.2.0");
  });

  it("returns failed silently when install throws", async () => {
    const check = vi.fn().mockResolvedValue({
      version: "0.2.0",
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("network"))
    });
    const updater = createAppUpdater({
      canUseAutoUpdater: true,
      check
    });
    await expect(updater.checkAndInstallSilently()).resolves.toBe("failed");
  });

  it("skips a second silent attempt in the same updater instance", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const updater = createAppUpdater({
      canUseAutoUpdater: true,
      check
    });
    await expect(updater.checkAndInstallSilently()).resolves.toBe("no-update");
    await expect(updater.checkAndInstallSilently()).resolves.toBe("skipped");
    expect(check).toHaveBeenCalledOnce();
  });

  it("skips silent updates when the user disabled automatic updates", async () => {
    const check = vi.fn();
    const updater = createAppUpdater({
      canUseAutoUpdater: true,
      check,
      isAutoUpdateEnabled: () => false
    });

    await expect(updater.checkAndInstallSilently()).resolves.toBe("skipped");
    expect(check).not.toHaveBeenCalled();
  });

  it("does not consume the silent attempt while the user has automatic updates disabled", async () => {
    let autoUpdateEnabled = false;
    const check = vi.fn().mockResolvedValue(null);
    const updater = createAppUpdater({
      canUseAutoUpdater: true,
      check,
      isAutoUpdateEnabled: () => autoUpdateEnabled
    });

    await expect(updater.checkAndInstallSilently()).resolves.toBe("skipped");
    autoUpdateEnabled = true;
    await expect(updater.checkAndInstallSilently()).resolves.toBe("no-update");
    expect(check).toHaveBeenCalledOnce();
  });

  describe("checkPortableUpdate", () => {
    it("returns null when no portable update is available", async () => {
      const { checkPortableUpdate } = await import("./appUpdater");
      const client = {
        checkPortableUpdate: vi.fn().mockResolvedValue(null),
        installPortableUpdate: vi.fn()
      };
      const result = await checkPortableUpdate(client as any);
      expect(result).toBeNull();
    });

    it("wraps portable update into an UpdateHandle and invokes install on downloadAndInstall", async () => {
      const { checkPortableUpdate } = await import("./appUpdater");
      const mockUpdate = {
        version: "0.2.0",
        currentVersion: "0.1.0",
        notes: "Portable update notes",
        url: "https://github.com/itzhang89/emr-management-tool/releases/download/v0.2.0/windows-amd64-portable.zip",
        signature: "sig-123"
      };
      const client = {
        checkPortableUpdate: vi.fn().mockResolvedValue(mockUpdate),
        installPortableUpdate: vi.fn().mockResolvedValue(undefined)
      };
      const handle = await checkPortableUpdate(client as any);
      expect(handle).not.toBeNull();
      expect(handle?.version).toBe("0.2.0");
      expect(handle?.body).toBe("Portable update notes");

      await handle?.downloadAndInstall();
      expect(client.installPortableUpdate).toHaveBeenCalledWith(mockUpdate);
    });
  });

  describe("resolveUpdateChecker", () => {
    it("routes portable distribution to portable update check", async () => {
      const { resolveUpdateChecker } = await import("./appUpdater");
      const checker = resolveUpdateChecker({
        appChannel: "stable",
        platform: "windows",
        version: "0.1.0",
        distribution: "portable",
        isPortable: true,
        isDevelopment: false,
        canUseAutoUpdater: true,
        channelLabel: "Stable"
      });
      expect(typeof checker).toBe("function");
    });
  });
});
