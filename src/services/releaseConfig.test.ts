import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("defines a development app identity without updater artifacts", () => {
    const developmentConfig = readJson<{
      productName: string;
      identifier: string;
      bundle: { createUpdaterArtifacts?: boolean; macOS?: { signingIdentity?: string } };
    }>("src-tauri/tauri.development.conf.json");

    expect(developmentConfig.productName).toBe("EMR Management Tool Dev");
    expect(developmentConfig.identifier).toBe("com.example.emr-management-tool.development");
    expect(developmentConfig.bundle.createUpdaterArtifacts).toBe(false);
    expect(developmentConfig.bundle.macOS?.signingIdentity).toBe("-");
  });

  it("keeps updater permissions scoped through the default Tauri capability", () => {
    const capability = readJson<{ permissions: string[] }>("src-tauri/capabilities/default.json");

    expect(capability.permissions).toContain("updater:default");
  });

  it("adds a release workflow with tag and development triggers", () => {
    const workflow = readText(".github/workflows/release.yml");

    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).toContain("development");
    expect(workflow).toContain("prepare-development-release:");
    expect(workflow).toContain("macos-development-amd64:");
    expect(workflow).toContain("macos-development-arm64:");
    expect(workflow).toContain("windows-development:");
    expect(workflow).toContain('REQUIRE_UPDATER_PUBLIC_KEY: "false"');
    expect(workflow).toContain("dev-v{0}");
    expect(workflow).toContain("cache-dependency-path: package-lock.json");
    expect(workflow).toContain("tauri.development.conf.json");
    expect(workflow).toContain("includeUpdaterJson");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(workflow).toContain("WINDOWS_SIGN_COMMAND");
    expect(workflow).toContain("TAURI_UPDATER_PUBLIC_KEY");
    expect(workflow).not.toContain("mac-debug");
    expect(workflow).not.toContain("tauri.debug.conf.json");
    expect(workflow).not.toContain("tauri.macos-test.conf.json");
  });

  it("runs macOS and Windows development package jobs in parallel", () => {
    const workflow = readText(".github/workflows/release.yml");
    const macosAmd64Development = workflowJobBlock(workflow, "macos-development-amd64");
    const macosArm64Development = workflowJobBlock(workflow, "macos-development-arm64");
    const windowsDevelopment = workflowJobBlock(workflow, "windows-development");

    expect(macosAmd64Development).toContain("needs: prepare-development-release");
    expect(macosArm64Development).toContain("needs: prepare-development-release");
    expect(windowsDevelopment).toContain("needs: prepare-development-release");
    expect(macosAmd64Development).not.toContain("needs: macos-development");
    expect(macosArm64Development).not.toContain("needs: macos-development");
    expect(windowsDevelopment).not.toContain("needs: macos-development");
  });

  it("builds development packages in debug mode like local Tauri dev builds", () => {
    const workflow = readText(".github/workflows/release.yml");
    const macosAmd64Development = workflowJobBlock(workflow, "macos-development-amd64");
    const macosArm64Development = workflowJobBlock(workflow, "macos-development-arm64");
    const windowsDevelopment = workflowJobBlock(workflow, "windows-development");

    expect(macosAmd64Development).toContain("RELEASE_CHANNEL: development");
    expect(macosAmd64Development).toContain("EMR_CREDENTIAL_STORE: local");
    expect(macosAmd64Development).not.toContain("RELEASE_VERSION:");
    expect(macosAmd64Development).toContain('REQUIRE_UPDATER_PUBLIC_KEY: "false"');
    expect(macosAmd64Development).toContain("npm run tauri -- build --debug --target x86_64-apple-darwin --config src-tauri/tauri.development.conf.json");

    expect(macosArm64Development).toContain("RELEASE_CHANNEL: development");
    expect(macosArm64Development).toContain("EMR_CREDENTIAL_STORE: local");
    expect(macosArm64Development).not.toContain("RELEASE_VERSION:");
    expect(macosArm64Development).toContain('REQUIRE_UPDATER_PUBLIC_KEY: "false"');
    expect(macosArm64Development).toContain("npm run tauri -- build --debug --target aarch64-apple-darwin --config src-tauri/tauri.development.conf.json");

    expect(windowsDevelopment).toContain("RELEASE_CHANNEL: development");
    expect(windowsDevelopment).toContain("EMR_CREDENTIAL_STORE: local");
    expect(windowsDevelopment).not.toContain("RELEASE_VERSION:");
    expect(windowsDevelopment).toContain('REQUIRE_UPDATER_PUBLIC_KEY: "false"');
    expect(windowsDevelopment).toContain("npm run tauri -- build --debug --config src-tauri/tauri.development.conf.json");
  });

  it("manually analyzes and uploads development artifacts instead of asking tauri-action for updater signatures", () => {
    const workflow = readText(".github/workflows/release.yml");
    const prepareDevelopmentRelease = workflowJobBlock(workflow, "prepare-development-release");
    const macosAmd64Development = workflowJobBlock(workflow, "macos-development-amd64");
    const macosArm64Development = workflowJobBlock(workflow, "macos-development-arm64");
    const windowsDevelopment = workflowJobBlock(workflow, "windows-development");

    expect(prepareDevelopmentRelease).toContain("GH_REPO: ${{ github.repository }}");

    for (const job of [macosAmd64Development, macosArm64Development, windowsDevelopment]) {
      expect(job).not.toContain("tauri-apps/tauri-action@v0");
      expect(job).toContain("Analyze build artifacts");
      expect(job).toContain("gh release upload");
    }

    expect(macosAmd64Development).toContain("macos-amd64");
    expect(macosArm64Development).toContain("macos-arm64");
    expect(windowsDevelopment).toContain("windows-amd64");
  });

  it("injects the release channel into Rust builds for credential backend selection", () => {
    const buildScript = readText("src-tauri/build.rs");

    expect(buildScript).toContain("cargo:rerun-if-env-changed=VITE_APP_CHANNEL");
    expect(buildScript).toContain("cargo:rerun-if-env-changed=RELEASE_CHANNEL");
    expect(buildScript).toContain("cargo:rustc-env=EMR_APP_CHANNEL=");
    expect(buildScript).toContain("cargo:rerun-if-env-changed=EMR_CREDENTIAL_STORE");
    expect(buildScript).toContain("cargo:rustc-env=EMR_CREDENTIAL_STORE=");
  });

  it("keeps release channel and credential store backend as separate build variables", () => {
    const workflow = readText(".github/workflows/release.yml");
    const windowsRelease = workflowJobBlock(workflow, "windows-release");

    expect(windowsRelease).toContain("RELEASE_CHANNEL: stable");
    expect(windowsRelease).toContain("EMR_CREDENTIAL_STORE: ${{ vars.EMR_CREDENTIAL_STORE || 'keychain' }}");
  });

  it("does not fail stable CI builds when updater keys are not configured", () => {
    withReleaseScriptWorkspace((workspace) => {
      execFileSync(process.execPath, ["scripts/prepare-release-config.mjs"], {
        cwd: workspace,
        env: {
          ...process.env,
          CI: "true",
          RELEASE_CHANNEL: "stable",
          RELEASE_VERSION: "0.2.0",
          REQUIRE_UPDATER_PUBLIC_KEY: "true",
          TAURI_UPDATER_PUBLIC_KEY: ""
        }
      });

      const tauriConfig = JSON.parse(readFileSync(join(workspace, "src-tauri/tauri.conf.json"), "utf8")) as {
        bundle: { createUpdaterArtifacts?: boolean };
      };
      expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(false);
    });
  });
});

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

function readText(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function workflowJobBlock(workflow: string, jobName: string) {
  const match = workflow.match(new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:\\n|\\n?$)`));
  if (!match) throw new Error(`Could not find ${jobName} job`);
  return match[0];
}

function withReleaseScriptWorkspace(callback: (workspace: string) => void) {
  const workspace = mkdtempSync(join(tmpdir(), "emr-release-config-"));

  try {
    mkdirSync(join(workspace, "scripts"), { recursive: true });
    mkdirSync(join(workspace, "src-tauri"), { recursive: true });
    cpSync(join(root, "scripts/prepare-release-config.mjs"), join(workspace, "scripts/prepare-release-config.mjs"));
    cpSync(join(root, "package.json"), join(workspace, "package.json"));
    cpSync(join(root, "package-lock.json"), join(workspace, "package-lock.json"));
    cpSync(join(root, "src-tauri/tauri.conf.json"), join(workspace, "src-tauri/tauri.conf.json"));
    cpSync(join(root, "src-tauri/Cargo.toml"), join(workspace, "src-tauri/Cargo.toml"));

    callback(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
