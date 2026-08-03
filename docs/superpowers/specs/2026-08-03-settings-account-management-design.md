# Settings Account Management Design

Date: 2026-08-03

## Goal

Unify AWS account add/edit under Configured Accounts, support editing name and region, confirm before delete, and switch active account via double-click.

## Decisions

- **Approach:** list + header `+` + shared `AccountFormDialog` (create/edit); remove the standalone AWS Credentials card.
- **`+` placement:** Configured Accounts card header, top-right.
- **Double-click row:** switch active account (Use button kept). Rename no longer uses double-click.
- **Edit credentials:** Access Key read-only (masked). Secret masked by default; **Change** unlocks editing. Full key-pair rotation = delete + add.
- **Delete:** confirmation dialog before calling delete.

## Backend

- `update_aws_account({ accountId, name, region, secretAccessKey? })` — updates name/region; optional secret with existing access key; STS test before save.
- `test_aws_account({ accountId, region, secretAccessKey? })` — tests using stored credentials (+ optional new secret).

## Frontend

- `AccountFormDialog`, `DeleteAccountDialog`
- `useUpdateAwsAccount`, `useTestAwsAccount`
- Active region change invalidates account-scoped queries (same family as account switch)

## Out of scope

- Editing Access Key ID in place
- AppShell switcher UX changes
- CLI Profiles / Future Auth restructuring
