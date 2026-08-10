import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPortableZip, listZipMembers, shouldSignPortableZip } from "./package-windows-portable.mjs";

describe("package-windows-portable", () => {
  it("zips a fake exe at the archive root with no extra members", () => {
    const workspace = mkdtempSync(join(tmpdir(), "emr-portable-zip-"));

    try {
      const exePath = join(workspace, "EMR-Management-Tool-Portable.exe");
      const zipPath = join(workspace, "windows-amd64-portable.zip");
      writeFileSync(exePath, "fake-portable-exe");

      createPortableZip(exePath, zipPath);

      expect(listZipMembers(zipPath)).toEqual(["EMR-Management-Tool-Portable.exe"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("signs when TAURI_SIGNING_PRIVATE_KEY is configured", () => {
    expect(shouldSignPortableZip({})).toBe(false);
    expect(shouldSignPortableZip({ TAURI_SIGNING_PRIVATE_KEY: "   " })).toBe(false);
    expect(shouldSignPortableZip({ TAURI_SIGNING_PRIVATE_KEY: "private-key" })).toBe(true);
  });
});
