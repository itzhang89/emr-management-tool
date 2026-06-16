import { readFileSync, writeFileSync } from "node:fs";

const channel = process.env.RELEASE_CHANNEL ?? "stable";
const rawVersion = process.env.RELEASE_VERSION;
const updaterPublicKey = process.env.TAURI_UPDATER_PUBLIC_KEY;
const windowsSignCommand = process.env.WINDOWS_SIGN_COMMAND;

if (rawVersion) {
  const version = rawVersion.replace(/^v/, "");
  updatePackageVersion(version);
  updatePackageLockVersion(version);
  updateTauriVersion(version);
  updateCargoVersion(version);
}

const tauriConfigPath = "src-tauri/tauri.conf.json";
const tauriConfig = readJson(tauriConfigPath);

if (updaterPublicKey) {
  tauriConfig.plugins ??= {};
  tauriConfig.plugins.updater ??= {};
  tauriConfig.plugins.updater.pubkey = updaterPublicKey.trim();
} else if (process.env.CI === "true" && channel === "stable" && process.env.REQUIRE_UPDATER_PUBLIC_KEY !== "false") {
  throw new Error("TAURI_UPDATER_PUBLIC_KEY is required for CI release builds.");
}

if (windowsSignCommand) {
  tauriConfig.bundle ??= {};
  tauriConfig.bundle.windows ??= {};
  tauriConfig.bundle.windows.signCommand = windowsSignCommand;
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
