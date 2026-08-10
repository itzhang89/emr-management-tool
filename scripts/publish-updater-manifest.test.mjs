import { describe, expect, it } from "vitest";
import { isInstallerWindowsBundle, isPortableWindowsBundle } from "./updater-assets.mjs";

describe("updater-assets", () => {
  it("classifies installer and portable Windows bundles", () => {
    expect(isInstallerWindowsBundle("windows-amd64-app-portable.zip")).toBe(false);
    expect(isInstallerWindowsBundle("app_0.1.0_x64-setup.nsis.zip")).toBe(true);
    expect(isPortableWindowsBundle("windows-amd64-EMR-portable.zip")).toBe(true);
    expect(isPortableWindowsBundle("app_0.1.0_x64-setup.exe")).toBe(false);
  });
});
