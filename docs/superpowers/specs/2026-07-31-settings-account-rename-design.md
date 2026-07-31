# Settings account rename

Date: 2026-07-31

## Goal

Allow renaming any configured AWS account display name on Settings via double-click, without changing credentials or region.

## Behavior

- Double-click account name in Configured Accounts → inline text input.
- Enter or blur with a changed non-empty trimmed name → persist via `rename_aws_account`.
- Escape or blur with unchanged / empty name → cancel edit.
- Toast on success/error; invalidate/update aws-accounts query so sidebar reflects the new name.

## Backend

- Command `rename_aws_account({ accountId, name })` → validation, load account, set name + updatedAt, upsert, return `AwsAccountSummary`.

## Out of scope

- Renaming credentials, region, or AWS identity fields.
- Separate rename button or dialog.
