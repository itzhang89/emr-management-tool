# Windows Portable Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a compile-time Windows portable build with `{exe}/data/` local storage, keep installers unchanged, and run a separate portable auto-update channel that self-replaces only portable zips.

**Architecture:** Inject `VITE_APP_DISTRIBUTION` / `EMR_APP_DISTRIBUTION` at build time. Portable builds force local credentials, resolve `app_data_dir` beside the exe, and embed only `stable-channel-portable` updater endpoints. CI adds a Windows portable matrix row that zips the exe (no NSIS), signs it when keys exist, and publishes `portable-latest.json` separately from installer `latest.json`. A Rust portable updater downloads/verifies/applies the zip without touching `data/`; the frontend routes portable builds to that path instead of Tauri’s installer updater.

**Tech Stack:** Tauri 2, React/Vite, GitHub Actions, Vitest, Rust (`zip`, `minisign-verify`, `reqwest`), existing `tauri signer` for artifact signatures.

## Global Constraints

- No `portable.txt` (or similar) runtime marker — portable is compile-time only.
- Do not mention VDI in docs; say **no administrator rights required**.
- Do not add Windows Authenticode / SmartScreen publisher signing in this work.
- Installer manifest must never list `*-portable.zip`; portable manifest must never list setup/msi.
- Portable stable updater endpoint: `https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel-portable/portable-latest.json` only.
- Preserve user `data/` on portable self-replace.
- Development portable: no automatic updates.
- macOS/Linux portable: out of scope.

## File map

| File | Responsibility |
| --- | --- |
| `src-tauri/build.rs` | Pass `EMR_APP_DISTRIBUTION` into Rust env |
| `src-tauri/src/distribution.rs` | `is_portable()`, helpers used by db/credentials/updater |
| `src-tauri/src/db/mod.rs` | Portable `{exe}/data/` vs AppData |
| `src-tauri/src/aws/credentials.rs` | Force local store when portable; store file under `app_data_dir()` |
| `src-tauri/tauri.portable.conf.json` | Portable productName/identifier/updater endpoints |
| `src-tauri/tauri.development.portable.conf.json` | Dev portable identity, no updater artifacts |
| `src-tauri/src/portable_updater.rs` | Check / download / verify / apply / relaunch |
| `src-tauri/src/commands/portable_updater.rs` | Tauri commands for frontend |
| `scripts/package-windows-portable.mjs` | Zip exe + optional sign |
| `scripts/publish-portable-updater-manifest.mjs` | Build `portable-latest.json` from portable assets only |
| `scripts/publish-updater-manifest.mjs` | Exclude portable zips from installer platforms |
| `.github/workflows/release.yml` | Portable matrix rows + publish jobs |
| `src/services/releaseInfo.ts` | `distribution` / `isPortable` / updater eligibility |
| `src/services/appUpdater.ts` | Route portable → invoke portable updater |
| `README.md`, `docs/release.md` | Portable install + split channels |

---

### Task 1: Distribution identity (frontend + build.rs)

**Files:**
- Modify: `src-tauri/build.rs`
- Modify: `src/vite-env.d.ts`
- Modify: `src/services/releaseInfo.ts`
- Modify: `src/services/releaseInfo.test.ts`

**Interfaces:**
- Produces: `AppDistribution = "installer" | "portable"`; `ReleaseInfo.distribution`, `ReleaseInfo.isPortable`; `canUseAutoUpdater` false for portable development, true for portable stable windows, true for installer stable windows/darwin (unchanged), false when portable+darwin (N/A).

- [ ] **Step 1: Write failing tests in `releaseInfo.test.ts`**

```ts
it("exposes portable distribution and updater eligibility", () => {
  const portable = createReleaseInfo({
    appChannel: "stable",
    platform: "windows",
    distribution: "portable"
  });
  expect(portable.distribution).toBe("portable");
  expect(portable.isPortable).toBe(true);
  expect(portable.canUseAutoUpdater).toBe(true);

  expect(
    createReleaseInfo({
      appChannel: "development",
      platform: "windows",
      distribution: "portable"
    }).canUseAutoUpdater
  ).toBe(false);

  expect(
    createReleaseInfo({
      appChannel: "stable",
      platform: "windows",
      distribution: "installer"
    }).canUseAutoUpdater
  ).toBe(true);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/services/releaseInfo.test.ts`

- [ ] **Step 3: Implement `releaseInfo.ts` + `vite-env.d.ts`**

```ts
export type AppDistribution = "installer" | "portable";

export interface ReleaseInfoInput {
  appChannel?: string;
  platform?: string;
  version?: string;
  distribution?: string;
}

// In createReleaseInfo:
const distribution = normalizeDistribution(input.distribution);
const isPortable = distribution === "portable";
const canUseAutoUpdater =
  appChannel === "stable" &&
  (isPortable
    ? platform === "windows"
    : platform === "windows" || platform === "darwin");

function normalizeDistribution(value?: string): AppDistribution {
  return value === "portable" ? "portable" : "installer";
}

// getReleaseInfo reads import.meta.env.VITE_APP_DISTRIBUTION
```

- [ ] **Step 4: Update `build.rs`**

```rust
println!("cargo:rerun-if-env-changed=VITE_APP_DISTRIBUTION");
let distribution = std::env::var("VITE_APP_DISTRIBUTION").unwrap_or_else(|_| "installer".to_string());
println!("cargo:rustc-env=EMR_APP_DISTRIBUTION={distribution}");
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npx vitest run src/services/releaseInfo.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/services/releaseInfo.ts src/services/releaseInfo.test.ts src/vite-env.d.ts src-tauri/build.rs
git commit -m "feat: add installer vs portable distribution identity"
```

---

### Task 2: Rust distribution helper + portable `app_data_dir`

**Files:**
- Create: `src-tauri/src/distribution.rs`
- Modify: `src-tauri/src/lib.rs` (mod distribution)
- Modify: `src-tauri/src/db/mod.rs`
- Test: unit tests inside `distribution.rs` and `db/mod.rs`

**Interfaces:**
- Produces: `pub fn app_distribution() -> &'static str`; `pub fn is_portable() -> bool` reading `option_env!("EMR_APP_DISTRIBUTION")`.
- Produces: `app_data_dir()` → `{exe_dir}/data` when portable, else `dirs::data_dir()/emr-management-tool`.
- Produces: `pub fn resolve_app_data_dir(is_portable: bool, exe_path: Option<&Path>) -> AppResult<PathBuf>` for tests.

- [ ] **Step 1: Write failing unit tests**

```rust
#[test]
fn portable_data_dir_is_beside_exe() {
    let exe = PathBuf::from("C:/tools/emr/app.exe");
    let dir = resolve_app_data_dir(true, Some(&exe)).unwrap();
    assert_eq!(dir, PathBuf::from("C:/tools/emr/data"));
}

#[test]
fn installer_data_dir_uses_system_data() {
    // When not portable, resolve_app_data_dir(false, _) joins emr-management-tool under a fake base passed via test helper
}
```

Prefer a testable helper:

```rust
pub fn resolve_app_data_dir_with_base(
    is_portable: bool,
    exe_path: Option<&Path>,
    system_data_dir: Option<PathBuf>,
) -> AppResult<PathBuf>
```

- [ ] **Step 2: Run `cargo test -p emr-management-tool distribution::` / db tests — expect FAIL**

- [ ] **Step 3: Implement**

```rust
// distribution.rs
pub fn is_portable() -> bool {
    matches!(option_env!("EMR_APP_DISTRIBUTION"), Some("portable"))
}

// db/mod.rs
pub fn app_data_dir() -> AppResult<PathBuf> {
    resolve_app_data_dir_with_base(
        crate::distribution::is_portable(),
        std::env::current_exe().ok().as_deref(),
        dirs::data_dir(),
    )
}

pub fn resolve_app_data_dir_with_base(
    is_portable: bool,
    exe_path: Option<&Path>,
    system_data_dir: Option<PathBuf>,
) -> AppResult<PathBuf> {
    if is_portable {
        let exe = exe_path.ok_or_else(|| AppError::storage("Unable to locate the application executable."))?;
        let parent = exe.parent().ok_or_else(|| AppError::storage("Unable to locate the application directory."))?;
        return Ok(parent.join("data"));
    }
    system_data_dir
        .map(|dir| dir.join("emr-management-tool"))
        .ok_or_else(|| AppError::storage("Unable to locate an application data directory."))
}
```

On first SQLite open failure due to permissions, keep existing storage error mapping; optionally improve message in `repository::pool` when `is_portable()` to mention writable folder — include that string in the `AppError::storage` when `create_dir_all` fails:

```rust
fs::create_dir_all(&dir).map_err(|error| {
    if crate::distribution::is_portable() {
        AppError::storage(format!(
            "Unable to create portable data directory at {}. Move the app to a writable folder. ({error})",
            dir.display()
        ))
    } else {
        AppError::storage(error.to_string())
    }
})?;
```

- [ ] **Step 4: `cargo test` for new tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/distribution.rs src-tauri/src/db/mod.rs src-tauri/src/db/repository.rs src-tauri/src/lib.rs
git commit -m "feat: resolve portable app data beside the executable"
```

---

### Task 3: Force local credentials under portable `data/`

**Files:**
- Modify: `src-tauri/src/aws/credentials.rs`
- Modify tests in the same file for `should_use_local_credential_store`

**Interfaces:**
- Extends `should_use_local_credential_store(..., distribution: Option<&str>)` → true when `distribution == Some("portable")` regardless of channel (still allow explicit `keychain` override only if you must — **spec says force local for portable**; ignore keychain override when portable).
- Store path: absolute `app_data_dir()?.join("emr-management-tool.credentials.json")` (keep `.dev.json` name only for debug if desired; prefer one filename `emr-management-tool.credentials.json` under `app_data_dir()`).

- [ ] **Step 1: Failing tests**

```rust
assert!(should_use_local_credential_store(false, Some("stable"), Some("keychain"), Some("portable")));
assert!(!should_use_local_credential_store(false, Some("stable"), None, Some("installer")));
```

- [ ] **Step 2: Implement** — portable short-circuits to local; `write_store_secret` / read / delete use:

```rust
fn credential_store_path(app: &AppHandle) -> AppResult<PathBuf> {
    // Prefer app_data_dir() so portable and installer stay aligned with SQLite root.
    Ok(crate::db::app_data_dir()?.join("emr-management-tool.credentials.json"))
}
// app.store(path) with PathBuf — convert via path.to_string_lossy() or PathBuf as supported by StoreExt
```

Ensure `create_dir_all(app_data_dir()?)` before store save.

- [ ] **Step 3: `cargo test` credentials tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/aws/credentials.rs
git commit -m "feat: keep portable AWS credentials in local data directory"
```

---

### Task 4: Portable Tauri configs

**Files:**
- Create: `src-tauri/tauri.portable.conf.json`
- Create: `src-tauri/tauri.development.portable.conf.json`
- Modify: `src/services/releaseConfig.test.ts` (assert product names + portable endpoint)
- Modify: `scripts/prepare-release-config.mjs` if portable builds need endpoint/pubkey injection (mirror stable behavior; portable config ships endpoint already)

**Interfaces:**
- Stable portable `productName`: `EMR Management Tool Portable`
- Stable portable `identifier`: `com.example.emr-management-tool.portable`
- Dev portable `productName`: `EMR Management Tool Dev Portable`
- Dev portable `identifier`: `com.example.emr-management-tool.development.portable`
- Stable portable updater endpoints: only `stable-channel-portable/portable-latest.json`
- Dev portable: `createUpdaterArtifacts: false`

- [ ] **Step 1: Add failing releaseConfig assertions for the new JSON files and endpoint URL**

- [ ] **Step 2: Add config files**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "EMR Management Tool Portable",
  "identifier": "com.example.emr-management-tool.portable",
  "bundle": {
    "createUpdaterArtifacts": false
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel-portable/portable-latest.json"
      ],
      "windows": { "installMode": "passive" }
    }
  }
}
```

Dev portable merges development naming + `createUpdaterArtifacts: false` (no updater endpoints required).

- [ ] **Step 3: Vitest releaseConfig — PASS**

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.portable.conf.json src-tauri/tauri.development.portable.conf.json src/services/releaseConfig.test.ts
git commit -m "feat: add Tauri configs for Windows portable builds"
```

---

### Task 5: Exclude portable zips from installer manifest + add portable manifest script

**Files:**
- Modify: `scripts/publish-updater-manifest.mjs`
- Create: `scripts/publish-portable-updater-manifest.mjs`
- Create: `scripts/publish-updater-manifest.test.mjs` (or extend vitest that shells out / imports helpers)

**Interfaces:**
- Installer Windows matcher: require `(nsis|msi|setup)` and **reject** `/portable/i`.
- Portable script: find asset matching `/portable\.zip$/i` (not setup), require `.sig`, write `portable-latest.json` with Tauri-compatible shape:

```json
{
  "version": "0.1.14",
  "notes": "...",
  "pub_date": "...",
  "platforms": {
    "windows-x86_64": { "url": "...", "signature": "..." }
  }
}
```

- [ ] **Step 1: Extract `isInstallerWindowsBundle(name)` / `isPortableWindowsBundle(name)` into shared helpers (same file or `scripts/updater-assets.mjs`) and unit-test:**

```js
assert(!isInstallerWindowsBundle("windows-amd64-app-portable.zip"));
assert(isInstallerWindowsBundle("app_0.1.0_x64-setup.nsis.zip"));
assert(isPortableWindowsBundle("windows-amd64-EMR-portable.zip"));
assert(!isPortableWindowsBundle("app_0.1.0_x64-setup.exe"));
```

- [ ] **Step 2: Implement scripts**

- [ ] **Step 3: Run node/vitest — PASS**

- [ ] **Step 4: Commit**

```bash
git add scripts/publish-updater-manifest.mjs scripts/publish-portable-updater-manifest.mjs scripts/updater-assets.mjs scripts/*.test.*
git commit -m "feat: split installer and portable updater manifests"
```

---

### Task 6: Package script for Windows portable zip

**Files:**
- Create: `scripts/package-windows-portable.mjs`
- Modify: `src/services/releaseConfig.test.ts` (script exists + signs when env set)

**Interfaces:**
- Inputs: `PORTABLE_EXE` (path), `PORTABLE_OUT` (zip path), optional `TAURI_SIGNING_PRIVATE_KEY` (+ password)
- Behavior: create zip containing only the exe at archive root (or single folder `EMR-Management-Tool-portable/` with exe inside — **prefer flat exe at zip root** for simpler apply; document in script header). Spec sample used a folder; **implementation choice: zip root contains the `.exe` only** so apply copies `*.exe` into `exe_dir`. Do not include `data/`.
- If signing keys present: run `npm run tauri -- signer sign <zip> -f ...` (match existing Tauri signer CLI) and write `<zip>.sig`.

- [ ] **Step 1: Write a small node test that zips a temp fake exe and asserts zip members**

- [ ] **Step 2: Implement `package-windows-portable.mjs`**

- [ ] **Step 3: Run test — PASS**

- [ ] **Step 4: Commit**

```bash
git add scripts/package-windows-portable.mjs
git commit -m "feat: add Windows portable zip packaging script"
```

---

### Task 7: CI matrix — build and upload portable packages

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `src/services/releaseConfig.test.ts` (matrix labels, env vars, publish job)

**Interfaces:**
- Add matrix rows (dev + stable manual + tag stable-release):
  - `windows-amd64-portable` / `stable-windows-amd64-portable`
  - `VITE_APP_DISTRIBUTION=portable`
  - `EMR_CREDENTIAL_STORE=local`
  - build with `--no-bundle` (or `--bundles none`) + `--config src-tauri/tauri.portable.conf.json` (dev: development.portable)
  - after build: `node scripts/package-windows-portable.mjs` → stage `*-portable.zip` (+ `.sig`)
- `publish-stable-updater` / `publish-tag-updater-manifest`: also run portable manifest script and upload to `stable-channel-portable` (create release if missing, like `stable-channel`).
- Tag `stable-release` Windows installer job stays; add parallel portable job (do not use tauri-action for portable upload — manual `gh release upload` like other manual jobs, or dedicated step after build).

- [ ] **Step 1: Extend releaseConfig workflow contract tests (labels, `VITE_APP_DISTRIBUTION`, `stable-channel-portable`, `package-windows-portable.mjs`)**

- [ ] **Step 2: Edit `release.yml` accordingly**

- [ ] **Step 3: Vitest releaseConfig — PASS**

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml src/services/releaseConfig.test.ts
git commit -m "ci: build and publish Windows portable release artifacts"
```

---

### Task 8: Rust portable updater (check / apply)

**Files:**
- Create: `src-tauri/src/portable_updater.rs`
- Create: `src-tauri/src/commands/portable_updater.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)
- Modify: `src-tauri/Cargo.toml` — add `reqwest` (rustls), `zip`, `minisign-verify` (versions compatible with edition 2021)
- Test: pure functions for version compare, path guards (`data/` skip), reject non-portable URLs

**Interfaces:**
- `check_portable_update() -> Result<Option<PortableUpdateInfo>, AppError>`
  - `PortableUpdateInfo { version: String, notes: Option<String>, url: String, signature: String }`
- `install_portable_update(update: PortableUpdateInfo) -> Result<(), AppError>`
- Only run when `is_portable()`; otherwise return storage/validation error.
- Fetch manifest from compile-time endpoint constant (same URL as config).
- Compare semver against `env!("CARGO_PKG_VERSION")` or injected `VITE_APP_VERSION` via build.rs (`EMR_APP_VERSION`).
- Download zip; verify minisign against `plugins.updater.pubkey` from config / `option_env` pubkey string already in `tauri.conf` (read via include or hardcode same pubkey source as prepare-release — prefer reading from a `const` duplicated from conf only if necessary; better: pass pubkey via `EMR_UPDATER_PUBLIC_KEY` build env from prepare-release-config).
- Extract to temp; copy files into `exe_dir` **skipping** any path whose first component is `data` or equals `data`.
- Windows: rename running exe to `.exe.old`, write new exe, `tauri::process::restart(&handler)` or spawn new process + exit.
- Delete `.exe.old` on next successful startup (small hook in `lib.rs` setup).

- [ ] **Step 1: Failing unit tests for skip-data + URL allowlist**

```rust
assert!(should_skip_archive_entry(Path::new("data/emr.sqlite")));
assert!(!should_skip_archive_entry(Path::new("EMR Management Tool Portable.exe")));
assert!(is_allowed_portable_asset_url("https://github.com/itzhang89/emr-management-tool/releases/download/v0.2.0/windows-amd64-foo-portable.zip"));
assert!(!is_allowed_portable_asset_url("https://evil.example/setup.exe"));
```

- [ ] **Step 2: Implement module + commands**

- [ ] **Step 3: `cargo test` — PASS**

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/portable_updater.rs src-tauri/src/commands/portable_updater.rs src-tauri/src/lib.rs src-tauri/build.rs
git commit -m "feat: add portable zip self-update commands"
```

---

### Task 9: Frontend appUpdater routing

**Files:**
- Modify: `src/services/appUpdater.ts`
- Modify: `src/services/appUpdater.test.ts`
- Modify: `src/services/tauriClient.ts` (add invoke wrappers if that is the project pattern)
- Modify: Settings/About unavailable reason string if needed (“stable Windows portable or installer builds”)

**Interfaces:**
- When `getReleaseInfo().isPortable`, `check` calls `check_portable_update` and `downloadAndInstall` calls `install_portable_update`.
- When installer, keep `@tauri-apps/plugin-updater` `check`.
- `createAppUpdater` dependency injection should accept the resolved `check` so tests stay pure.

- [ ] **Step 1: Failing tests — portable uses injectable portable check; installer uses tauri check**

- [ ] **Step 2: Implement wiring**

```ts
export const appUpdater = createAppUpdater({
  canUseAutoUpdater: getReleaseInfo().canUseAutoUpdater,
  check: getReleaseInfo().isPortable ? checkPortableUpdate : checkTauriUpdate
});
```

Map portable invoke results into `UpdateHandle`.

- [ ] **Step 3: Vitest appUpdater — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/services/appUpdater.ts src/services/appUpdater.test.ts src/services/tauriClient.ts
git commit -m "feat: route portable builds through portable updater"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/release.md`

- [ ] **Step 1: README Install section** — add Windows portable zip bullet; note no administrator rights; data in `data/`; SmartScreen optional note; no VDI.

- [ ] **Step 2: `docs/release.md`** — portable matrix, `stable-channel-portable`, `VITE_APP_DISTRIBUTION`, credential local force, separate manifests.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/release.md
git commit -m "docs: document Windows portable packages and update channels"
```

---

### Task 11: Verification gate

- [ ] **Step 1: Run** `npx vitest run src/services/releaseInfo.test.ts src/services/appUpdater.test.ts src/services/releaseConfig.test.ts`

- [ ] **Step 2: Run** `cargo test` in `src-tauri`

- [ ] **Step 3: Confirm checklist vs spec**
  - Compile-time portable identity
  - `{exe}/data/` + local credentials
  - Installer unchanged path
  - Split manifests / CI portable zip
  - Portable self-update preserves `data/`
  - Docs without VDI; no Authenticode work

- [ ] **Step 4: Final commit only if verification fixes were needed**

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Compile-time distribution | 1, 4 |
| `{exe}/data/` | 2 |
| Local credentials under data | 3 |
| Keep installers | 4, 7 (separate rows) |
| Separate update channels + portable self-replace | 5, 8, 9 |
| CI zip + `stable-channel-portable` | 6, 7 |
| Installer manifest excludes portable | 5 |
| Docs no-admin, no VDI, no Authenticode | 10 |
| Dev portable no auto-update | 1, 4, 9 |

## Placeholder / consistency notes

- Manifest names fixed: `portable-latest.json`, release `stable-channel-portable`.
- Zip layout fixed for implementers: **exe at zip root** (Task 6); apply logic matches.
- Pubkey for verify: inject `EMR_UPDATER_PUBLIC_KEY` in `build.rs` from `TAURI_UPDATER_PUBLIC_KEY` during CI `prepare-release-config` (extend that script in Task 8 if not already writing it).
