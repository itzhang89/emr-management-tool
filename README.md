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

## AWS Account Permissions

The app calls AWS directly through the SDK. Grant only the permissions needed for the features you use.

### Permission Matrix

| Feature | AWS service | Minimum actions |
| --- | --- | --- |
| Settings: test connection | STS | `sts:GetCallerIdentity` |
| Virtual Clusters | EMR on EKS | `emr-containers:ListVirtualClusters` |
| Submit / cancel jobs | EMR on EKS | `emr-containers:StartJobRun`, `emr-containers:CancelJobRun` |
| Job history / details | EMR on EKS | `emr-containers:ListJobRuns`, `emr-containers:DescribeJobRun` |
| Job submission (execution role) | IAM | `iam:PassRole` on the job execution role |
| Logs (CloudWatch) | CloudWatch Logs | `logs:DescribeLogStreams`, `logs:FilterLogEvents` |
| Logs (S3) | S3 | `s3:ListBucket`, `s3:GetObject` on the log bucket |
| S3 Browser (read) | S3 | `s3:ListAllMyBuckets`, `s3:ListBucket`, `s3:GetObject`, `s3:GetBucketLocation` |
| S3 Browser (edit) | S3 | `s3:PutObject`, `s3:DeleteObject`, `s3:CopyObject` on target buckets |

Notes:

- `sts:GetCallerIdentity` is required for every account added in Settings.
- Job submission needs `iam:PassRole` for the execution role ARN used in the submit form. Scope it to that role and `emr-containers.amazonaws.com`.
- CloudWatch log permissions can be scoped to EMR log groups, for example `/aws/emr-containers/*`.
- S3 Browser resolves bucket region automatically. The account region in Settings should still match your EMR virtual cluster region.
- If buckets use SSE-KMS, you may also need `kms:Decrypt` and `kms:GenerateDataKey` on the relevant KMS keys.

### Example: EMR on EKS only (no S3 Browser editing)

Replace `ACCOUNT_ID`, `REGION`, and `EXECUTION_ROLE_NAME` before use.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EmrManagementToolSts",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    },
    {
      "Sid": "EmrManagementToolEmrContainers",
      "Effect": "Allow",
      "Action": [
        "emr-containers:ListVirtualClusters",
        "emr-containers:ListJobRuns",
        "emr-containers:DescribeJobRun",
        "emr-containers:StartJobRun",
        "emr-containers:CancelJobRun"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EmrManagementToolPassExecutionRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::ACCOUNT_ID:role/EXECUTION_ROLE_NAME",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "emr-containers.amazonaws.com"
        }
      }
    },
    {
      "Sid": "EmrManagementToolCloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogStreams",
        "logs:FilterLogEvents"
      ],
      "Resource": "arn:aws:logs:REGION:ACCOUNT_ID:log-group:/aws/emr-containers/*"
    }
  ]
}
```

### Example: add read-only S3 Browser and job log buckets

Add this statement and replace `LOG_BUCKET` with your EMR log bucket name:

```json
{
  "Sid": "EmrManagementToolS3Read",
  "Effect": "Allow",
  "Action": [
    "s3:ListAllMyBuckets",
    "s3:ListBucket",
    "s3:GetObject",
    "s3:GetBucketLocation"
  ],
  "Resource": [
    "arn:aws:s3:::LOG_BUCKET",
    "arn:aws:s3:::LOG_BUCKET/*"
  ]
}
```

To browse all buckets in the account, use `"Resource": ["arn:aws:s3:::*", "arn:aws:s3:::*/*"]` instead of a single bucket.

### Example: full S3 Browser (upload, save, delete, rename)

Add write actions on the buckets you want to edit:

```json
{
  "Sid": "EmrManagementToolS3Write",
  "Effect": "Allow",
  "Action": [
    "s3:PutObject",
    "s3:DeleteObject",
    "s3:CopyObject"
  ],
  "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
}
```

Rename uses `CopyObject` plus `DeleteObject` on the same bucket prefix.

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
