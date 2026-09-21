# Beta Update Channel Design

Date: 2026-09-21

## Goal

Make prereleases a real update path for this app, and give them meaningful names.

Before this change the `development` channel produced `development-build-<run_number>`:
a tag that is not a version, so it could not take part in version comparison, and builds
that set `createUpdaterArtifacts: false` and never received the signing secrets. A tester who
installed one could only get the next by re-downloading. `releaseInfo.canUseAutoUpdater` was
also false for every non-`stable` channel, so even a signed prerelease could not have updated
itself.

Now: prereleases are **betas of the next patch version**, built in two profiles, delivered
over a signed **beta channel** the user opts into from Settings (default **off**).

## Decisions

| # | Decision |
|---|---|
| 1 | Betas are numbered after the newest **stable** release: `v0.2.1` → `v0.2.2-beta1`, `beta2`, … → `v0.2.2`. Reusing `v0.2.1-beta1` was rejected: semver orders it *below* the released `v0.2.1`, so nothing would ever be offered it. |
| 2 | The version is **derived by CI**, never typed. `scripts/beta-version.mjs` scans the repository's tags. |
| 3 | Each beta ships **two profiles under one version** — release and debug. |
| 4 | The **release profile carries the stable identity** (`EMR Management Tool` / `com.example.emr-management-tool`) so an existing install can actually receive betas. |
| 5 | The **debug profile keeps the Dev identity** (`EMR Management Tool Dev` / `….development`), installs side by side and never self-updates. |
| 6 | The channel is a **user preference**, not a build identity. A stable install with the switch on reads the beta channel; a beta install with it off reads stable again. |
| 7 | `latest.json` must point at release-profile artifacts only. |

## Channel behaviour

| Installed build | Beta updates | Manifest read | Outcome |
|---|---|---|---|
| stable `0.2.1` | off | `stable-channel` | `0.2.2` when it ships |
| stable `0.2.1` | **on** | `beta-channel` | `0.2.2-beta1`, then `beta2`, … |
| beta `0.2.2-beta1` | **on** | `beta-channel` | `beta2`, `beta3`, … |
| beta `0.2.2-beta1` | off | `stable-channel` | `0.2.2` when it ships — a clean exit from betas |
| debug beta / `development` | — | none | never self-updates |

## Application

- `src/services/updateChannelPreferences.ts` — localStorage `emr-eks:beta-updates`, default off,
  mirroring `autoUpdatePreferences.ts`.
- `src/pages/SettingsPage.tsx` — a "Beta updates" switch beside the existing auto-update one.
- `src-tauri/src/update_channel.rs` — the `UpdateChannel` enum and the manifest URLs. The
  channel arrives from the WebView, so it is parsed through an allow-list rather than
  interpolated into a URL. `build_can_update()` refuses updates for `development` builds.
- `src-tauri/src/app_updater.rs` — installer-channel checks. These exist because the Tauri
  updater plugin cannot take endpoints at runtime: its JS `check()` accepts only
  headers/timeout/proxy/target/allowDowngrades, and the command behind it forwards exactly
  those. Only `UpdaterBuilder::endpoints` overrides the configured endpoints, so a
  channel-aware check has to live in Rust. Stable keeps the endpoints from `tauri.conf.json`
  (including the fallback); beta points at its own manifest. Install re-checks in Rust rather
  than trusting a version from the WebView.
- `src-tauri/src/portable_updater.rs` — takes the channel instead of hardcoding the stable
  portable manifest and refusing every other channel.
- `src/services/releaseInfo.ts` — `beta` joins the channel set; `canUseAutoUpdater` now means
  "this build may replace itself" (any packaged build), while the channel choice is the user's.

## Release pipeline

- `release_channel: [beta, stable]`. A beta dispatch derives its tag and creates the release
  as a **published prerelease** — never a draft, since the updater fetches assets over public
  URLs.
- The beta matrix is generated: 4 platforms × 2 profiles, labels `beta-<platform>[-debug]`.
  Distinct labels are load-bearing — the macOS `.app.tar.gz` name carries no version, so the
  two profiles of one beta would otherwise stage under identical names.
- `publish-beta-updater` assembles `beta-channel/latest.json` and
  `beta-channel-portable/portable-latest.json` from release-profile assets only
  (`ASSET_PROFILE`, backed by `isDebugAsset` in `scripts/updater-assets.mjs`).
- `stable-release` and `publish-tag-updater-manifest` skip tags containing `-`, because
  `v*.*.*` also matches `v0.2.2-beta1` and a hand-pushed beta tag would otherwise overwrite
  `stable-channel` with a beta manifest.

## MSI versioning

Tauri's WiX bundler computes the MSI `ProductVersion` with `convert_version`, which bails
unless a prerelease identifier is numeric-only. It consults `bundle.windows.wix.version`
first, so `prepare-release-config.mjs` pins that to `0.2.2.<beta ordinal>` for betas and
leaves it unset for stable releases. Consequence: MSI has no prerelease concept, so a beta's
`0.2.2.1` outranks the eventual stable `0.2.2` and a hand-installed MSI needs an uninstall
before the stable MSI. The in-app updater is unaffected — it installs the NSIS `setup.exe`.

## Out of scope

- Notarization and Apple Developer signing (macOS packages remain ad-hoc signed).
- A separate `beta-channel` for the debug profile. Both profiles share a version, so a
  manifest cannot distinguish them; debug packages are manual downloads.
- Selecting a channel on a per-account or per-workspace basis.
