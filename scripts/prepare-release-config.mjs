import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { assertReleaseVersion, normalizeReleaseVersion } from "./release-version.mjs";

const channel = process.env.RELEASE_CHANNEL ?? "stable";
const rawVersion = process.env.RELEASE_VERSION;
const appPlatform = process.env.VITE_APP_PLATFORM;
const appleCertificate = process.env.APPLE_CERTIFICATE;
const appleSigningIdentity = process.env.APPLE_SIGNING_IDENTITY;
const updaterPublicKey = process.env.TAURI_UPDATER_PUBLIC_KEY;
const updaterPrivateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
const windowsSignCommand = process.env.WINDOWS_SIGN_COMMAND;

if (rawVersion) {
  const version =
    process.env.CI === "true" && process.env.GITHUB_EVENT_NAME === "push"
      ? assertReleaseVersion(rawVersion, { label: "git tag" })
      : normalizeReleaseVersion(rawVersion);

  if (!version) {
    throw new Error("RELEASE_VERSION is set but could not be normalized.");
  }

  updatePackageVersion(version);
  updatePackageLockVersion(version);
  updateTauriVersion(version);
  updateCargoVersion(version);
  exportBuildVersion(version);
  console.log(`Prepared release version ${version} from ${rawVersion}`);
}

const tauriConfigPath = "src-tauri/tauri.conf.json";
const tauriConfig = readJson(tauriConfigPath);

if (updaterPublicKey?.trim() && updaterPrivateKey?.trim()) {
  tauriConfig.plugins ??= {};
  tauriConfig.plugins.updater ??= {};
  tauriConfig.plugins.updater.pubkey = updaterPublicKey.trim();
} else {
  tauriConfig.bundle ??= {};
  tauriConfig.bundle.createUpdaterArtifacts = false;

  if (process.env.CI === "true" && channel === "stable" && process.env.REQUIRE_UPDATER_PUBLIC_KEY === "true") {
    console.warn("Updater signing keys are not configured; building without automatic update artifacts.");
  }
}

// The WiX bundler rejects a non-numeric prerelease identifier
// (`convert_version` in tauri-bundler bails unless `version.pre` parses as u64),
// but it consults `bundle.windows.wix.version` first. Betas therefore pin an
// explicit 4-part MSI version — the beta ordinal in the build field — while the
// app version stays `0.2.2-beta1`. Stable releases leave it unset so the
// bundler derives it from the version as before.
const wixVersion = msiVersionFor(rawVersion ? normalizeReleaseVersion(rawVersion) : null);
if (wixVersion) {
  tauriConfig.bundle ??= {};
  tauriConfig.bundle.windows ??= {};
  tauriConfig.bundle.windows.wix ??= {};
  tauriConfig.bundle.windows.wix.version = wixVersion;
}

if (windowsSignCommand) {
  tauriConfig.bundle ??= {};
  tauriConfig.bundle.windows ??= {};
  tauriConfig.bundle.windows.signCommand = windowsSignCommand;
}

if (appPlatform === "darwin") {
  tauriConfig.bundle ??= {};
  tauriConfig.bundle.macOS ??= {};

  if (appleCertificate?.trim() && appleSigningIdentity?.trim()) {
    tauriConfig.bundle.macOS.signingIdentity = appleSigningIdentity.trim();
  } else if (process.env.CI === "true") {
    tauriConfig.bundle.macOS.signingIdentity = "-";
  }
}

writeJson(tauriConfigPath, tauriConfig);

function updatePackageVersion(version) {
  const packageJson = readJson("package.json");
  packageJson.version = version;
  writeJson("package.json", packageJson);
}

function updatePackageLockVersion(version) {
  const packageLock = readJson("package-lock.json");
  packageLock.version = version;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }
  writeJson("package-lock.json", packageLock);
}

function updateTauriVersion(version) {
  const config = readJson("src-tauri/tauri.conf.json");
  config.version = version;
  writeJson("src-tauri/tauri.conf.json", config);
}

function updateCargoVersion(version) {
  const cargoPath = "src-tauri/Cargo.toml";
  const cargoToml = readFileSync(cargoPath, "utf8");
  writeFileSync(cargoPath, cargoToml.replace(/^version = "[^"]+"/m, `version = "${version}"`));
}

/**
 * MSI version for a prerelease, or `null` to let the bundler derive it.
 *
 * `0.2.2-beta7` → `0.2.2.7`. WiX allows at most 255/255/65535/65535, and the
 * beta ordinal is what makes each beta outrank the previous one so MSI upgrades
 * chain. A version whose ordinal is not a plain integer has no MSI form.
 */
function msiVersionFor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)-beta(\d+)$/.exec(version ?? "");
  if (!match) return null;
  const [, major, minor, patch, beta] = match;
  if (Number(major) > 255 || Number(minor) > 255 || Number(patch) > 65535 || Number(beta) > 65535) {
    throw new Error(`Beta version ${version} cannot be expressed as an MSI version.`);
  }
  return `${major}.${minor}.${patch}.${beta}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function exportBuildVersion(version) {
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `VITE_APP_VERSION=${version}\n`);
  }
}
