# Windows Portable Release Design

## Goals

1. Ship a **Windows portable** distribution: unzip to a writable folder and run without administrator rights.
2. Keep existing Windows **installer** packages (NSIS `.exe` / `.msi`) unchanged in behavior.
3. Make portable a **compile-time** distribution (not a runtime marker file such as `portable.txt`).
4. Store portable app data and AWS credentials under `{exe_dir}/data/` (local store only).
5. Split **update channels**: installer updates only installer artifacts; portable updates only portable zip and can self-replace.
6. Document no-admin usage and optional SmartScreen “Run anyway”; do **not** document VDI; do **not** add code signing in this work.

## Decisions

| Topic | Choice |
| --- | --- |
| Detection | Build-time `distribution=portable` vs `installer` (default) |
| Data dir (portable) | `{directory_of_exe}/data/` |
| Credentials (portable) | Force `EMR_CREDENTIAL_STORE=local`; files under `data/` |
| Credentials (installer stable) | Unchanged (keychain by default) |
| Auto-update | Both channels supported; manifests and endpoints strictly separated |
| Portable update UX | In-app check → download portable zip → verify → replace binaries → restart; preserve `data/` |
| Marker file | Out of scope — no `portable.txt` |
| Code signing / SmartScreen publisher | Out of scope |
| macOS / Linux portable | Out of scope |

## Architecture

### Build identity

Inject at build time (Rust + Vite):

- `EMR_APP_DISTRIBUTION` / `VITE_APP_DISTRIBUTION`: `portable` | `installer` (default `installer`)
- Portable Windows CI also sets `EMR_CREDENTIAL_STORE=local`
- Frontend `releaseInfo` exposes `distribution` / `isPortable`
- Portable Windows builds use a distinct `productName` that includes `Portable` (and development portable uses the existing Dev naming plus Portable) so About / window title cannot be confused with the installer

Installer builds omit portable identity and keep current stable/development channel behavior.

### Data and credentials

**Portable**

- `app_data_dir()` resolves to `{exe_dir}/data/` (create on first use).
- SQLite and related files live under that directory.
- Local credential store (`tauri-plugin-store`) must resolve under the same `data/` root (align store path with `app_data_dir()`).
- If `data/` cannot be created or written, fail with a clear storage error asking the user to run from a writable location.

**Installer**

- Keep `%AppData%\emr-management-tool\` via `dirs::data_dir()`.
- Stable keychain / local override behavior unchanged.

### Packaging

**Installer (existing)**

- NSIS setup `.exe` and `.msi` as today.
- Updater artifacts for the installer channel when signing keys are configured.

**Portable (new)**

Zip layout example:

```text
EMR-Management-Tool-<version>-windows-amd64-portable/
  EMR Management Tool.exe   # actual productName.exe
  data/                     # created at runtime if missing
```

- CI builds Windows twice when producing Windows packages: installer pass, then portable pass (or equivalent matrix row).
- Stage and upload `*-portable.zip` (and `.sig` when updater keys exist).
- Artifact naming must make installer vs portable obvious (e.g. `windows-amd64-…-portable.zip`).

## Update channels

### Separation rules

| | Installer | Portable |
| --- | --- | --- |
| `distribution` | `installer` | `portable` |
| Manifest | Existing rolling release `stable-channel` + `latest.json` | Rolling release `stable-channel-portable` + `portable-latest.json` (also uploaded to the versioned GitHub Release) |
| Artifacts listed | NSIS/MSI updater payloads only | Portable zip (+ signature) only |
| Embedded endpoints | Current installer endpoints | Portable endpoints only |
| `canUseAutoUpdater` | `stable` + windows/darwin + not portable | `stable` + windows + portable |

- Installer manifest must not list portable zips.
- Portable manifest must not list setup/msi.
- Development portable: no automatic updates (same policy as development installers), unless a later change explicitly opts in.

### Portable self-replace flow

1. Check portable manifest for a newer version (url + signature).
2. Download to a temp directory; verify signature when keys are configured.
3. Extract to a staging directory.
4. Replace application binaries next to the running exe; **do not overwrite** user `data/`.
5. Relaunch the app.
6. On failure: leave the previous binaries and `data/` intact; surface an error.

**Implementation note:** Tauri’s stock Windows updater targets installers. Portable self-replace is a **portable-specific update path** (may reuse manifest/signature conventions, custom apply step). Keep it separate from the installer updater plugin path.

### CI / publish

- Portable updater endpoint embedded in portable builds (primary and only stable endpoint):
  - `https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel-portable/portable-latest.json`
- Versioned GitHub Releases (tag or manual stable build tag) also host the portable zip, `.sig`, and a copy of `portable-latest.json` for that build.
- When updater keys are present, publish installer `latest.json` to `stable-channel` and `portable-latest.json` to `stable-channel-portable` after stable Windows builds.
- Tag releases and manual stable Windows jobs include portable zip (+ sig) and update the portable rolling manifest.
- Extend existing updater-manifest scripts or add a sibling script so installer and portable generation cannot cross-contaminate platforms/assets.

## Frontend

- `createReleaseInfo` / `getReleaseInfo`: add `distribution` and `isPortable`; `canUseAutoUpdater` respects the table above.
- Settings / About: portable stable can check and install updates via the portable updater API; unavailable copy for development / non-supported cases stays clear.
- Do not offer installer download/install from a portable build (and vice versa).

## Documentation

Update `README.md` and `docs/release.md`:

- Windows portable: unzip to a writable folder, run exe, **no administrator rights required**.
- Data and credentials live in `data/` beside the exe; copy the folder to migrate.
- Installer packages remain documented.
- Optional: unsigned builds may show SmartScreen; use More info → Run anyway.
- Do **not** mention VDI.
- Document the two update channels and that they do not share packages.

## Testing

- Unit: portable build identity → local credentials, `app_data_dir` under exe, updater endpoints/flags.
- Unit: installer build identity → AppData path logic, existing updater eligibility.
- Unit/contract: installer manifest excludes portable assets; portable manifest excludes installer assets.
- Unit: portable apply preserves `data/` and refuses cross-channel URLs if guarded in code.
- Workflow/config tests: release matrix builds and uploads portable zip; publishes portable manifest when keys exist.

## Non-goals

- Windows code signing / removing SmartScreen “Unknown publisher”.
- Runtime `portable.txt` (or similar) detection.
- macOS or Linux portable packages.
- Automatic migration of AppData/keychain data into a portable `data/` folder.
- Portable auto-update on development channel.
- Changing macOS release or notarization posture.
