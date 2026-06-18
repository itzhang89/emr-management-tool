import { describe, expect, it, vi } from "vitest";
import { createAppUpdater } from "./appUpdater";

describe("createAppUpdater", () => {
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
});
