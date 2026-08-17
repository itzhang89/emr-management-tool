# Release Pipeline

This project publishes desktop installers through GitHub Actions and GitHub Releases.

## Channels

- Stable tag release: push a tag like `v0.2.0`. The workflow builds Windows (installer + portable) and macOS (amd64 + arm64) packages, signs updater artifacts when keys are configured, uploads release assets, and publishes `latest.json` to `stable-channel` and `portable-latest.json` to `stable-channel-portable`.
- Manual builds: run the `Release` workflow manually and choose `release_channel` plus `credential_store`. The workflow prepares a `<channel>-build-<run_number>` GitHub release automatically, so no version input is required.
- Development: choose `release_channel=development`. The workflow builds Windows (installer + portable), macOS amd64 (`x86_64`), and macOS arm64 (`aarch64`) packages in parallel with Tauri debug mode, matching the local `npm run tauri -- dev` channel/storage behavior. It disables updater artifacts and does not upload `latest.json`.
- Stable manual test: choose `release_channel=stable`. The workflow builds release-mode packages for the selected targets, assigns version `0.1.<run_number>`, and when updater keys are configured publishes `latest.json` to `stable-channel` and `portable-latest.json` to `stable-channel-portable`.

Manual development jobs do not use `tauri-action` for release uploads. Each job runs `npm run tauri -- build --debug ...`, prints the generated bundle tree for diagnostics, stages only installable package files, and uploads those files with `gh release upload`. This avoids updater signature lookups such as `.app.tar.gz.sig` for builds that intentionally do not support automatic updates.

Manual stable jobs assemble `latest.json` in a separate `publish-stable-updater` job after all platform builds finish. This avoids parallel jobs racing on the same updater manifest file.

## Build Variables

- `RELEASE_CHANNEL`: release channel only. Use `stable` for official releases and `development` for manual development builds.
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

Development builds do not support automatic updates and use a separate product name and bundle identifier:

- Product name: `EMR Management Tool Dev`
- Identifier: `com.example.emr-management-tool.development`

Installing a new macOS development package replaces the previous development app, but it does not replace the stable app.

## Updater Endpoints

### Installer Channel
Stable installer builds check these endpoints in order:

1. `https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel/latest.json`
2. `https://github.com/itzhang89/emr-management-tool/releases/latest/download/latest.json`

### Portable Channel
Stable portable builds check this endpoint:

1. `https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel-portable/portable-latest.json`

The rolling `stable-channel` and `stable-channel-portable` releases are updated by manual stable builds and tag releases when updater keys are configured.
