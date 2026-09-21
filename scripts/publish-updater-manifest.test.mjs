import { describe, expect, it } from "vitest";
import {
  isDebugAsset,
  isInstallerWindowsBundle,
  isPortableWindowsBundle,
  selectProfileAssets
} from "./updater-assets.mjs";

describe("updater-assets", () => {
  it("classifies installer and portable Windows bundles", () => {
    expect(isInstallerWindowsBundle("windows-amd64-app-portable.zip")).toBe(false);
    expect(isInstallerWindowsBundle("app_0.1.0_x64-setup.nsis.zip")).toBe(true);
    expect(isPortableWindowsBundle("windows-amd64-EMR-portable.zip")).toBe(true);
    expect(isPortableWindowsBundle("app_0.1.0_x64-setup.exe")).toBe(false);
  });

  describe("isDebugAsset", () => {
    it("matches debug-profile staging labels", () => {
      expect(isDebugAsset("beta-macos-arm64-debug-EMR.Management.Tool.Dev_aarch64.app.tar.gz")).toBe(true);
      expect(isDebugAsset("beta-windows-amd64-debug-EMR.Management.Tool.Dev_0.1.0_x64-setup.exe")).toBe(true);
      expect(isDebugAsset("beta-windows-amd64-portable-debug-windows-amd64-portable.zip")).toBe(true);
    });

    it("leaves release-profile and stable assets alone", () => {
      expect(isDebugAsset("beta-macos-arm64-EMR.Management.Tool_aarch64.app.tar.gz")).toBe(false);
      expect(isDebugAsset("beta-windows-amd64-EMR.Management.Tool_0.1.0_x64-setup.exe")).toBe(false);
      expect(isDebugAsset("EMR.Management.Tool_0.2.1_x64-setup.exe")).toBe(false);
      expect(isDebugAsset("debugging-tools.zip")).toBe(false);
    });

    it("is what keeps a debug build out of the manifest, not the bundle matchers", () => {
      const debugInstaller = "beta-windows-amd64-debug-EMR.Management.Tool.Dev_0.1.0_x64-setup.exe";
      // The installer matcher alone would happily accept it.
      expect(isInstallerWindowsBundle(debugInstaller)).toBe(true);
      expect(isDebugAsset(debugInstaller)).toBe(true);
    });
  });

  describe("selectProfileAssets", () => {
    const assets = [
      { name: "beta-macos-arm64-EMR.Management.Tool_aarch64.app.tar.gz" },
      { name: "beta-macos-arm64-debug-EMR.Management.Tool.Dev_aarch64.app.tar.gz" },
      { name: "beta-windows-amd64-EMR.Management.Tool_0.1.0_x64-setup.exe" },
      { name: "beta-windows-amd64-debug-EMR.Management.Tool.Dev_0.1.0_x64-setup.exe" }
    ];

    it("defaults to the release profile so an update never lands on a debug build", () => {
      const previous = process.env.ASSET_PROFILE;
      delete process.env.ASSET_PROFILE;
      try {
        expect(selectProfileAssets(assets).map((asset) => asset.name)).toEqual([
          "beta-macos-arm64-EMR.Management.Tool_aarch64.app.tar.gz",
          "beta-windows-amd64-EMR.Management.Tool_0.1.0_x64-setup.exe"
        ]);
      } finally {
        if (previous !== undefined) process.env.ASSET_PROFILE = previous;
      }
    });

    it("can select either profile explicitly", () => {
      expect(selectProfileAssets(assets, "debug")).toHaveLength(2);
      expect(selectProfileAssets(assets, "all")).toHaveLength(4);
    });
  });
});
