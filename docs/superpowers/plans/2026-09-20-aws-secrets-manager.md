# AWS Secrets Manager + DBHub Binding — Plan

Implements `docs/superpowers/specs/2026-09-20-aws-secrets-manager-design.md`.

Locked constraints:

- AWS Secrets Manager only (not local keychain UI).
- Create-only writes in P0; Update/Delete deferred to P2 with `submitUser` ownership.
- DBHub binds by **ARN**; JSON overlay at dial time; manual auth unchanged and unmigrated.
- SecretString: list/describe never return it; Copy prefers clipboard; Reveal opt-in.

---

## Phase 0 — Scaffold nav + types

- [ ] Extend `PageId` + `navigationItems` in `src/pages/pageMeta.ts` (`secrets`, label
      `Secrets`, description `AWS Secrets Manager`, icon `KeyRound`, insert before Settings).
- [ ] Lazy-load `SecretsPage` in `AppShell.tsx` and add switch branch.
- [ ] ZH keys in `src/i18n/locales/zh/navigation.ts` (`Secrets` → `密钥管理`, description).
- [ ] Update pageMeta / AppShell / navigation i18n coverage tests.
- [ ] Stub `src/pages/SecretsPage.tsx` (account/region header + empty list shell).

**Done when:** sidebar shows the item in the right place; keyboard Mod+N order includes it; ZH label works.

---

## Phase 1 — Rust AWS SM client + Create/List/Describe/Copy

- [ ] Add `aws-sdk-secretsmanager` to `src-tauri/Cargo.toml` (same features as other aws-sdk-* crates).
- [ ] `src-tauri/src/aws/secrets_manager.rs`: client from active-account runtime; map SDK types →
      `SecretSummary` / `SecretDetail` (no SecretString).
- [ ] Tag constants: `submitUser`, `managedBy=emr-management-tool`.
- [ ] `src-tauri/src/commands/secrets_manager.rs`:
  - `list_secrets`
  - `describe_secret`
  - `create_secret` (force/merge ownership tags; reject forged `submitUser`)
  - `get_secret_value_for_copy` (clipboard via Tauri plugin if available)
  - `get_secret_value_for_reveal` (explicit; document no React Query persistence)
- [ ] Register commands in `lib.rs` / `generate_handler!`.
- [ ] `tauriClient.ts` camelCase wrappers + domain types in `src/types/domain.ts`.
- [ ] Unit tests: tag merge, ownership forge rejection, summary mapping without secret string.
- [ ] IAM / `AccessDenied` → `AppError` message listing required actions.

**Done when:** `cargo test` passes for new module; invoke create/list against a real account in manual smoke.

---

## Phase 2 — Secrets page UI (P0 product)

- [ ] `useSecrets` hooks (React Query keys scoped by `accountId` + region).
- [ ] List table: name, description, tags chips, last changed, View / Copy actions.
- [ ] Search box + optional **Mine only** checkbox (`submitUser == useSubmitUser()`).
- [ ] `CreateSecretDialog`: name, description, JSON value (+ template insert), read-only auto tags.
- [ ] Detail drawer: metadata; masked value; Copy; Reveal toggle; re-mask on close.
- [ ] Empty / loading / no-active-account / IAM error states.
- [ ] i18n shard for page copy (`zh/secrets.ts` or equivalent) + coverage.

**Done when:** P0 acceptance in the design doc is met on a desktop build.

---

## Phase 3 — DBHub schema + resolve (P1)

- [ ] Migrate `db_connections`: add `auth_mode` (default `manual`), `secret_arn`, `secret_name`
      (follow existing `alter table` + `pragma table_info` guard in `store.rs`).
- [ ] Extend domain types / `ConnectionInput` / list DTO (expose mode + arn/name, never secret value).
- [ ] Validate on create/update: mode vs arn consistency.
- [ ] Dial/test path in `session` (or equivalent): if `aws_secret`, `GetSecretValue` → parse JSON →
      overlay host/port/username/password/database → connect.
- [ ] Clear errors for missing ARN, access denied, bad JSON, missing password after merge.
- [ ] Account delete cascade: drop local rows only; do **not** call DeleteSecret on AWS.
- [ ] Rust tests: overlay merge matrix; manual path regression.

**Done when:** a connection with `auth_mode=aws_secret` can Test/Save/Query using SM JSON only.

---

## Phase 4 — DBHub form + Overview (P1 UI)

- [ ] `ConnectionFormDialog`: auth mode radio; SM picker (list_secrets, prefer `{kind}.*`);
      hide password when SM selected; link to Secrets page.
- [ ] Overview card badge: `Manual` vs `SM: {name|arn-suffix}`.
- [ ] Ensure rename connection does not clear `secret_arn`.
- [ ] i18n for new form strings; no migration CTA for existing manual connections.

**Done when:** P1 acceptance in the design doc is met; user B can bind A’s secret.

---

## Phase 5 — P2 write ops (later)

- [ ] `update_secret_value` / `put_secret_value` gated by `submitUser` ownership.
- [ ] `delete_secret` gated the same way; recovery window; confirm dialog.
- [ ] Disable Edit/Delete in UI when not owner; explain why.
- [ ] Optional: Create-from-connection shortcut (prefill `{kind}.{sanitizedName}` + JSON from form).

**Done when:** P2 acceptance in the design doc is met.

---

## Manual smoke checklist

1. Switch account → Secrets list region matches Settings region.
2. Create `mysql.demo_ro` JSON secret → tags show local submitUser + managedBy.
3. Copy value → paste elsewhere matches; list network tab / IPC has no SecretString.
4. DBHub: new MySQL connection → AWS Secrets Manager → bind that ARN → Test OK without local password.
5. Rename connection → still connects via same ARN.
6. Second OS user (or forged expectation): can bind; cannot Delete in P2.
7. Manual connection still saves password to local keychain only.

---

## File touch map (expected)

| Area | Files |
|---|---|
| Nav | `pageMeta.ts`, `AppShell.tsx`, `zh/navigation.ts`, page tests |
| AWS SM | `Cargo.toml`, `aws/secrets_manager.rs`, `commands/secrets_manager.rs`, `lib.rs` |
| Frontend SM | `SecretsPage.tsx`, hooks/services, `tauriClient.ts`, `domain.ts`, i18n |
| DBHub | `db/dbhub/store.rs`, `commands/dbhub.rs`, `session.rs`, `ConnectionFormDialog.tsx`, `OverviewPanel.tsx`, `useDbHub.ts` |
| Docs | this plan + design spec (already added) |
