export function isInstallerWindowsBundle(name) {
  if (/portable/i.test(name)) return false;
  return /(nsis|msi|setup)/i.test(name);
}

export function isPortableWindowsBundle(name) {
  return /portable\.zip$/i.test(name);
}

/**
 * Debug-profile assets carry a `-debug` label segment (e.g.
 * `beta-macos-arm64-debug-…`). They are published for manual troubleshooting
 * but must never be offered as an update: they use the Dev product name and
 * bundle identifier, so installing one would replace a stable-identity app with
 * a differently-identified one.
 */
export function isDebugAsset(name) {
  return /(^|-)debug(-|\.|$)/i.test(name);
}

/**
 * Filters a release's assets down to one build profile. Defaults to `release`
 * so an update manifest can never point at a debug build.
 */
export function selectProfileAssets(assets, profile = process.env.ASSET_PROFILE ?? "release") {
  if (profile === "all") return assets;
  return assets.filter((asset) =>
    profile === "debug" ? isDebugAsset(asset.name) : !isDebugAsset(asset.name)
  );
}
