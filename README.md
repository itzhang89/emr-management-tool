# EMR Management Tool

EMR Management Tool is a desktop GUI for submitting and managing Amazon EMR on EKS jobs. It is built with Tauri, React, and TypeScript.

## Features

- Manage named AWS accounts and import local AWS CLI profiles.
- Browse EMR virtual clusters in the selected AWS region.
- Submit EMR on EKS jobs from reusable job and resource templates.
- Preview job payloads before submission.
- View local job history and clone previous submissions.
- Read EMR job logs and browse S3 log/output files.
- Check for application updates on supported stable releases.

## Install

Download the package for your operating system from GitHub Releases:

- macOS Apple Silicon: `macos-arm64` / `aarch64`
- macOS Intel: `macos-amd64` / `x64`
- Windows: `.exe` or `.msi`

On macOS, if the package is built without an Apple Developer ID certificate, macOS may block the first launch. Confirm the package source before opening it.

## First Use

1. Open the app.
2. Go to `Settings`.
3. Add an AWS account manually or import an AWS CLI profile.
4. Select the active account and region.
5. Open `Virtual Clusters` to confirm EMR on EKS access.
6. Open `Submit Job`, choose a template, preview the payload, and submit.

## Development

Requirements:

- Node.js 22
- Rust stable
- Platform-specific Tauri prerequisites

Install dependencies:

```bash
npm ci
```

Run the app in development mode:

```bash
npm run tauri -- dev
```

Build a local package:

```bash
npm run tauri -- build
```

Build a macOS development package:

```bash
npm run tauri -- build --debug --target aarch64-apple-darwin --config src-tauri/tauri.development.conf.json
```

## Release Channels

- `development`: debug build, local credential store, no automatic updates.
- `stable`: release build. Windows stable releases support automatic updates when signing keys are configured.

Credential storage is controlled at build time with `EMR_CREDENTIAL_STORE`:

- `auto`: development uses local storage; stable uses the OS keychain.
- `local`: store credentials in the local app store.
- `keychain`: store credentials in the OS keychain.
