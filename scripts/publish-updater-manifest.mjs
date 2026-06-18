import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UPDATER_TARGETS = [
  {
    platform: "darwin-aarch64",
    isBundle: (name) => /\.app\.tar\.gz$/i.test(name) && /(aarch64|arm64)/i.test(name)
  },
  {
    platform: "darwin-x86_64",
    isBundle: (name) =>
      /\.app\.tar\.gz$/i.test(name) &&
      /(amd64|x86_64|-x64)/i.test(name) &&
      !/(aarch64|arm64)/i.test(name)
  },
  {
    platform: "windows-x86_64",
    isBundle: (name) =>
      /\.(nsis\.zip|msi\.zip)$/i.test(name) ||
      (/\.zip$/i.test(name) && /(setup|nsis|windows)/i.test(name))
  }
];

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

const version = (process.env.RELEASE_VERSION ?? "").replace(/^v/, "");
const releaseTag = process.env.RELEASE_TAG;
const repo = process.env.GITHUB_REPOSITORY;
const notes = process.env.RELEASE_NOTES ?? "";

if (!version || !releaseTag || !repo) {
  throw new Error("RELEASE_VERSION, RELEASE_TAG, and GITHUB_REPOSITORY are required.");
}

const assets = JSON.parse(gh("release", "view", releaseTag, "--repo", repo, "--json", "assets")).assets;
const platforms = {};

for (const target of UPDATER_TARGETS) {
  const bundle = assets.find((asset) => target.isBundle(asset.name));
  if (!bundle) {
    console.warn(`No bundle found for ${target.platform}`);
    continue;
  }

  const sigAsset = assets.find((asset) => asset.name === `${bundle.name}.sig`);
  if (!sigAsset) {
    console.warn(`Missing signature for ${bundle.name}`);
    continue;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "emr-updater-sig-"));
  try {
    execFileSync("gh", ["release", "download", releaseTag, "--repo", repo, "--pattern", sigAsset.name, "--dir", tempDir]);
    platforms[target.platform] = {
      url: bundle.url,
      signature: readFileSync(join(tempDir, sigAsset.name), "utf8").trim()
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (Object.keys(platforms).length === 0) {
  throw new Error(`No updater artifacts found on release ${releaseTag}.`);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms
};

writeFileSync("latest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote latest.json for ${version} with platforms: ${Object.keys(platforms).join(", ")}`);
