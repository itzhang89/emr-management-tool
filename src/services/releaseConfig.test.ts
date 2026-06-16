import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("release configuration", () => {
  it("keeps package, Tauri config, and Cargo package versions aligned", () => {
    const packageJson = readJson<{ version: string }>("package.json");
    const tauriConfig = readJson<{ version: string }>("src-tauri/tauri.conf.json");
    const cargoToml = readText("src-tauri/Cargo.toml");
    const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];

    expect(packageJson.version).toBe(tauriConfig.version);
    expect(cargoVersion).toBe(tauriConfig.version);
  });

  it("configures signed updater artifacts for the stable Windows release channel", () => {
    const tauriConfig = readJson<{
      bundle: { createUpdaterArtifacts?: boolean };
      plugins?: { updater?: { pubkey?: string; endpoints?: string[]; windows?: { installMode?: string } } };
    }>("src-tauri/tauri.conf.json");

    expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(true);
    expect(tauriConfig.plugins?.updater?.pubkey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(tauriConfig.plugins?.updater?.endpoints).toEqual([
      "https://github.com/itzhang89/emr-management-tool/releases/latest/download/latest.json"
    ]);
    expect(tauriConfig.plugins?.updater?.windows?.installMode).toBe("passive");
  });

  it("defines a separate macOS debug app identity", () => {
    const debugConfig = readJson<{
      productName: string;
      identifier: string;
      bundle: { createUpdaterArtifacts?: boolean; macOS?: { signingIdentity?: string } };
    }>("src-tauri/tauri.debug.conf.json");

    expect(debugConfig.productName).toBe("EMR Management Tool Debug");
    expect(debugConfig.identifier).toBe("com.example.emr-management-tool.debug");
    expect(debugConfig.bundle.createUpdaterArtifacts).toBe(false);
    expect(debugConfig.bundle.macOS?.signingIdentity).toBe("-");
  });

  it("keeps updater permissions scoped through the default Tauri capability", () => {
    const capability = readJson<{ permissions: string[] }>("src-tauri/capabilities/default.json");

    expect(capability.permissions).toContain("updater:default");
  });

  it("adds a release workflow with tag, manual test, and macOS debug triggers", () => {
    const workflow = readText(".github/workflows/release.yml");

    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).toContain("mac-debug-latest");
    expect(workflow).toContain("includeUpdaterJson");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(workflow).toContain("WINDOWS_SIGN_COMMAND");
    expect(workflow).toContain("TAURI_UPDATER_PUBLIC_KEY");
  });

  it("injects the release channel into Rust builds for credential backend selection", () => {
    const buildScript = readText("src-tauri/build.rs");

    expect(buildScript).toContain("cargo:rerun-if-env-changed=VITE_APP_CHANNEL");
    expect(buildScript).toContain("cargo:rerun-if-env-changed=RELEASE_CHANNEL");
    expect(buildScript).toContain("cargo:rustc-env=EMR_APP_CHANNEL=");
  });
});

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

function readText(path: string) {
  return readFileSync(join(root, path), "utf8");
}
