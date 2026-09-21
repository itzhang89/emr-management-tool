# Release Pipeline

This project publishes desktop installers through GitHub Actions and GitHub Releases.

## Channels

- Stable tag release: push a tag like `v0.2.0`. The workflow builds Windows (installer + portable) and macOS (amd64 + arm64) packages, signs updater artifacts when keys are configured, uploads release assets, and publishes `latest.json` to `stable-channel` and `portable-latest.json` to `stable-channel-portable`.
- Beta: choose `release_channel=beta`. The workflow derives the next version from the newest **stable** release — `v0.2.1` produces `v0.2.2-beta1`, then `v0.2.2-beta2`, … — so no version input is ever required. Each beta ships **two profiles under one version**: a release-profile build (stable identity, signed, the one the beta channel delivers) and a debug-profile build (Dev identity, installs side by side, never self-updates). Debug artifacts carry a `-debug` label segment so the updater manifest can exclude them. `latest.json` goes to `beta-channel` and `portable-latest.json` to `beta-channel-portable`.
- Stable manual test: choose `release_channel=stable`. The workflow builds release-mode packages for the selected targets, assigns version `0.1.<run_number>`, and when updater keys are configured publishes `latest.json` to `stable-channel` and `portable-latest.json` to `stable-channel-portable`.

Beta and manual stable jobs do not use `tauri-action` for release uploads. Each job runs `npm run tauri -- build ...`, prints the generated bundle tree for diagnostics, stages only installable package files under a label-scoped name, and uploads those files with `gh release upload`. The label matters: the macOS `.app.tar.gz` name contains no version, so the two profiles of one beta would otherwise stage under byte-identical names and clobber each other.

Beta releases are always **published**, never drafted — the updater fetches their assets over public URLs, which a draft release does not serve. Because `v*.*.*` also matches a beta tag, `stable-release` and `publish-tag-updater-manifest` skip any tag containing `-`; betas are cut by a dispatch, and a hand-pushed beta tag deliberately builds nothing.

Manual stable jobs assemble `latest.json` in a separate `publish-stable-updater` job after all platform builds finish. This avoids parallel jobs racing on the same updater manifest file.

## Build Variables

- `RELEASE_CHANNEL`: release channel only. Use `stable` for official releases and `beta` for prereleases. `development` remains the value local `npm run tauri -- dev` builds carry; it is not a CI channel.
- `EMR_CREDENTIAL_STORE`: credential backend only. Use `auto`, `local`, or `keychain`.
- `VITE_APP_DISTRIBUTION` / `EMR_APP_DISTRIBUTION`: package distribution type (`installer` or `portable`). Portable builds force local credential storage and store application data in a `data/` folder beside the executable.

`auto` keeps the default behavior: debug/development builds use the local store, while stable release builds use the OS keychain. Set `EMR_CREDENTIAL_STORE=local` when you need a release build whose credentials are stored in the local app store instead of the keychain. Portable builds always use local storage regardless of channel.

## Windows Portable Distribution

Windows portable builds (`*-portable.zip`) require no administrator rights:

- **Local data directory**: All SQLite database files and encrypted credential stores live in `{exe_dir}/data/`.
- **Self-replacement updater**: In-app updater downloads the new portable zip, verifies the signature, renames the running executable, extracts the new binary, and relaunches the app. The `data/` directory is never modified or overwritten during update apply.
- **Dedicated channel**: Portable builds embed only the `stable-channel-portable` manifest endpoint and will never download or apply installer packages.

## Optional GitHub Secrets

These secrets are required only when publishing automatic update artifacts. If they are missing, CI still builds installers, but it disables updater artifacts and does not upload `latest.json`.

- `TAURI_UPDATER_PUBLIC_KEY`: public key injected into `src-tauri/tauri.conf.json` during CI.
- `TAURI_SIGNING_PRIVATE_KEY`: private key used by Tauri to sign updater artifacts.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password for the private key. Leave empty only if the key was generated without a password.

Generate the updater key pair with the Tauri CLI:

```bash
npm run tauri signer generate -- -w ~/.tauri/emr-management-tool.key
```

Put the contents of `~/.tauri/emr-management-tool.key.pub` in `TAURI_UPDATER_PUBLIC_KEY`, and the contents of `~/.tauri/emr-management-tool.key` in `TAURI_SIGNING_PRIVATE_KEY`.

## Windows Signing

Windows code signing is optional until a certificate provider is selected. To enable it, configure:

- `WINDOWS_SIGN_COMMAND`: command used by Tauri's Windows bundler to sign generated artifacts.

The workflow injects this command into `bundle.windows.signCommand` before running `tauri-action`.

## macOS Status

There is no Apple Developer signing configured yet. macOS packages use ad-hoc signing (`signingIdentity = "-"`) and are not notarized. Stable macOS builds can still use the in-app updater: updates are applied in place, which usually avoids repeat Gatekeeper prompts after the first **Allow Anyway**.

Debug-profile beta packages and local dev builds use a separate product name and bundle identifier:

- Product name: `EMR Management Tool Dev`
- Identifier: `com.example.emr-management-tool.development`

Installing a new macOS debug package replaces the previous debug app, but it does not replace the stable app. These builds never self-update: every published package carries the stable identity, so applying one would leave the app in a mixed state. Release-profile betas do carry that identity and update in place — which is what lets someone on a stable release opt into betas from Settings and get them delivered.

A beta install does not converge back to stable on its own. Turning the beta switch off makes the app read `stable-channel` again, where `v0.2.2` outranks `v0.2.2-beta2`, so the next stable release arrives as a normal update.

## MSI versioning for betas

Tauri's WiX bundler rejects a non-numeric prerelease identifier (`0.2.2-beta1` cannot be an MSI `ProductVersion`), so `scripts/prepare-release-config.mjs` pins `bundle.windows.wix.version` to the four-part form `0.2.2.1` for betas — the beta ordinal in the build field, which keeps MSI upgrades chaining beta to beta. Stable releases leave the field unset so the bundler derives it. Note that MSI has no prerelease concept: a beta's `0.2.2.1` outranks the eventual stable `0.2.2`, so a hand-installed MSI needs an uninstall before the stable MSI. The in-app updater is unaffected — it installs the NSIS `setup.exe`.

## Updater Endpoints

### Installer Channel
Stable installer builds check these endpoints in order:

1. `https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel/latest.json`
2. `https://github.com/itzhang89/emr-management-tool/releases/latest/download/latest.json`

### Beta Channel
A stable or beta install whose user enables **Beta updates** in Settings checks this endpoint instead:

1. `https://github.com/itzhang89/emr-management-tool/releases/download/beta-channel/latest.json`

The beta channel is opt-in and off by default. Turning it off points the app back at the stable endpoints, so the next stable release is offered normally. The installer path goes through the Rust commands in `src-tauri/src/app_updater.rs` rather than the updater plugin's JS `check()`: only the Rust builder can override endpoints, and selecting a channel is exactly that.

### Portable Channel
Stable portable builds check this endpoint:

1. `https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel-portable/portable-latest.json`

Beta portable builds check `beta-channel-portable/portable-latest.json` instead. Both rolling channels are updated by CI when updater keys are configured, and each manifest lists only release-profile artifacts — the debug profile shares the version, so a manifest that could pick it would hand beta users a Dev-identity app.
