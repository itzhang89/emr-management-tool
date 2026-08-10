import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertReleaseVersion } from "./release-version.mjs";
import { isPortableWindowsBundle } from "./updater-assets.mjs";

const PORTABLE_TARGET = {
  platform: "windows-x86_64",
  isBundle: isPortableWindowsBundle
};

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

const version = assertReleaseVersion(process.env.RELEASE_VERSION ?? "", { label: "RELEASE_VERSION" });
const releaseTag = process.env.RELEASE_TAG;
const repo = process.env.GITHUB_REPOSITORY;
const notes = process.env.RELEASE_NOTES ?? "";

if (!version || !releaseTag || !repo) {
  throw new Error("RELEASE_VERSION, RELEASE_TAG, and GITHUB_REPOSITORY are required.");
}

const assets = JSON.parse(gh("release", "view", releaseTag, "--repo", repo, "--json", "assets")).assets;
const platforms = {};

const bundle = assets.find((asset) => PORTABLE_TARGET.isBundle(asset.name));
if (!bundle) {
  throw new Error(`No portable Windows bundle found on release ${releaseTag}.`);
}

const sigAsset = assets.find((asset) => asset.name === `${bundle.name}.sig`);
if (!sigAsset) {
  throw new Error(`Missing signature for ${bundle.name}`);
}

const tempDir = mkdtempSync(join(tmpdir(), "emr-portable-updater-sig-"));
try {
  execFileSync("gh", ["release", "download", releaseTag, "--repo", repo, "--pattern", sigAsset.name, "--dir", tempDir]);
  platforms[PORTABLE_TARGET.platform] = {
    url: bundle.url,
    signature: readFileSync(join(tempDir, sigAsset.name), "utf8").trim()
  };
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms
};

writeFileSync("portable-latest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote portable-latest.json for ${version}`);
