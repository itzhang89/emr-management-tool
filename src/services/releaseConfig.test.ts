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
    expect(workflow).not.toContain("\n      version:");
    expect(workflow).toContain("release_channel:");
    expect(workflow).toContain("credential_store:");
    expect(workflow).toContain("prepare-manual-release:");
    expect(workflow).toContain("manual-development-packages:");
    expect(workflow).toContain("manual-stable-windows-package:");
    expect(workflow).toContain('REQUIRE_UPDATER_PUBLIC_KEY: "false"');
    expect(workflow).toContain("${RELEASE_CHANNEL}-build-${GITHUB_RUN_NUMBER}");
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
    const developmentPackages = workflowJobBlock(workflow, "manual-development-packages");

    expect(developmentPackages).toContain("needs: prepare-manual-release");
    expect(developmentPackages).toContain("fail-fast: false");
    expect(developmentPackages).toContain("label: macos-amd64");
    expect(developmentPackages).toContain("label: macos-arm64");
    expect(developmentPackages).toContain("label: windows-amd64");
  });

  it("builds development packages in debug mode like local Tauri dev builds", () => {
    const workflow = readText(".github/workflows/release.yml");
    const developmentPackages = workflowJobBlock(workflow, "manual-development-packages");

    expect(developmentPackages).toContain("if: ${{ github.event_name == 'workflow_dispatch' && inputs.release_channel == 'development' }}");
    expect(developmentPackages).toContain("RELEASE_CHANNEL: ${{ inputs.release_channel }}");
    expect(developmentPackages).toContain("EMR_CREDENTIAL_STORE: ${{ inputs.credential_store }}");
    expect(developmentPackages).not.toContain("RELEASE_VERSION:");
    expect(developmentPackages).toContain('REQUIRE_UPDATER_PUBLIC_KEY: "false"');
    expect(developmentPackages).toContain("npm run tauri -- build ${{ matrix.build_args }}");
    expect(developmentPackages).toContain("--debug --target x86_64-apple-darwin --config src-tauri/tauri.development.conf.json");
    expect(developmentPackages).toContain("--debug --target aarch64-apple-darwin --config src-tauri/tauri.development.conf.json");
    expect(developmentPackages).toContain("--debug --config src-tauri/tauri.development.conf.json");
  });

  it("manually analyzes and uploads development artifacts instead of asking tauri-action for updater signatures", () => {
    const workflow = readText(".github/workflows/release.yml");
    const prepareDevelopmentRelease = workflowJobBlock(workflow, "prepare-manual-release");
    const developmentPackages = workflowJobBlock(workflow, "manual-development-packages");

    expect(prepareDevelopmentRelease).toContain("GH_REPO: ${{ github.repository }}");

    expect(developmentPackages).not.toContain("tauri-apps/tauri-action@v0");
    expect(developmentPackages).toContain("Analyze build artifacts");
    expect(developmentPackages).toContain("gh release upload");
    expect(developmentPackages).toContain("macos-amd64");
    expect(developmentPackages).toContain("macos-arm64");
    expect(developmentPackages).toContain("windows-amd64");
  });

  it("builds stable manual packages without requiring a version input", () => {
    const workflow = readText(".github/workflows/release.yml");
    const stablePackage = workflowJobBlock(workflow, "manual-stable-windows-package");

    expect(stablePackage).toContain("if: ${{ github.event_name == 'workflow_dispatch' && inputs.release_channel == 'stable' }}");
    expect(stablePackage).toContain("RELEASE_CHANNEL: ${{ inputs.release_channel }}");
    expect(stablePackage).toContain("EMR_CREDENTIAL_STORE: ${{ inputs.credential_store }}");
    expect(stablePackage).not.toContain("RELEASE_VERSION:");
    expect(stablePackage).toContain("npm run tauri -- build --config src-tauri/tauri.conf.json");
    expect(stablePackage).toContain("stable-windows-amd64");
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
