# AWS Secrets Manager + DBHub Secret Binding Design

Date: 2026-09-20

## Goal

1. Add a top-level **Secrets** sidebar page that lists / inspects / creates secrets in
   **AWS Secrets Manager** for the active AWS account (same region as Settings).
2. Secrets written by this desktop tool carry the local user in `createdBy` /
   `lastModifiedBy` tags, so multi-user sharing of one AWS account stays
   attributable without restricting who may write.
3. Let DBHub connections optionally **bind an SM secret by ARN** and pull
   `username` / `password` / `host` / `port` / `database` from a JSON value, instead
   of (or in addition to) typing credentials manually.

This is **not** a UI over the local OS keychain (`secrets.rs`). Local keyring continues
to hold AK/SK, LLM keys, SSH profile secrets, and DBHub **manual** passwords.

## Decisions (locked)

| # | Decision |
|---|---|
| 1 | Target store is **AWS Secrets Manager** only |
| 2 | Secret value is **one JSON object** (username, password, host, port, database, …) |
| 3 | DBHub binds **ARN once**; renaming the connection display name does not rename or rebind the secret |
| 4 | List defaults to **all secrets** in the account region |
| 5 | Cross-user bind is **allowed** (A creates, B may bind) |
| 6 | Region is **fixed** to the active account’s Settings region |
| 7 | v1 write surface = **Create only**; later Update + Delete, shared rather than owner-gated (see Attribution rule below) |
| 8 | SecretString may be revealed in UI; **masked by default**; primary action is **Copy value** |
| 9 | Manual password auth and SM binding **coexist**; **no migration** wizard |
| 10 | Sidebar label follows locale: EN `Secrets` / ZH `密钥管理`; placed **above Settings** |

### Attribution rule (Update / Delete, post-v1)

> Secrets are **shared**: any secret the app can list may be updated or deleted,
> whoever created it, including secrets created in the AWS console. Writes are
> attributed instead of gated — Create stamps `createdBy`, Update refreshes
> `lastModifiedBy`, both set to `get_submit_user()`. “Mine only” filters on
> `createdBy`.
>
> *Revision (2026-09-21):* this replaces the earlier owner-only rule, which
> required an exact `submitUser` match for Update/Delete and stamped
> `managedBy=emr-management-tool`. Those tags are no longer written; existing
> secrets keep them untouched, and they are simply displayed as ordinary tags.

## Out of scope (v1)

- UpdateSecret / PutSecretValue / DeleteSecret (planned v1.1)
- Cross-region browsing or region picker
- Managing local keychain entries from the Secrets page
- Migrating existing `auth_mode=manual` connections into SM
- Rotation configuration, resource policies, replica regions
- MCP exposure of secret values (never)

---

## 1. Navigation

| Field | Value |
|---|---|
| `PageId` | `secrets` |
| EN label / description | `Secrets` / `AWS Secrets Manager` |
| ZH | `密钥管理` / `AWS Secrets Manager` |
| Icon | `KeyRound` (lucide) |
| Order | Immediately **before** Settings in `navigationItems` |
| Scope | Active AWS account + that account’s `region` |

Touch points (same pattern as prior nav additions):

- `src/pages/pageMeta.ts` — `PageId` + `navigationItems`
- `src/components/layout/AppShell.tsx` — lazy page + switch branch
- `src/i18n/locales/zh/navigation.ts` — EN→ZH keys
- `src/services/pageNavigation.ts` / pageMeta tests / AppShell tests
- Optional help shortcut copy in `zh/help.ts`

---

## 2. Secrets page UX

```
┌─ Secrets ─────────────────────────────────────────────────────┐
│  Account: {name} · Region: {region} (read-only)               │
│                              [Refresh]  [+ Create Secret]     │
│  Search [________]   □ Mine only                              │
├───────────────────────────────────────────────────────────────┤
│  Name │ Description │ Tags │ Last changed │ Actions           │
│  …    │ …           │ …    │ …            │ View · Copy       │
└───────────────────────────────────────────────────────────────┘
```

- **Mine only**: filter where tag `createdBy == get_submit_user()` (client-side or
  ListSecrets filter if cheap; v1 may filter after list). Editing someone else’s
  secret does **not** make it “mine”.
- Untagged secrets show a muted “untagged” chip; still bindable.
- Empty / no-account / IAM-denied states use the same empty/error patterns as S3 / Glue.

### Create Secret dialog

| Field | Rules |
|---|---|
| Name | Required. Suggested pattern `{driver}.{connect_name}` (e.g. `mysql.sales_ro`); validated as SM name rules; **not** forced to match a DBHub connection name |
| Description | Optional |
| Value | JSON textarea (or structured form that serializes to JSON). Template button inserts the schema below |
| Tags (auto, non-removable in UI) | Create: `createdBy=<get_submit_user()>`; Update: `lastModifiedBy=<get_submit_user()>` |
| Tags (optional) | e.g. `purpose=dbhub` |

On success: invalidate list query; do **not** persist SecretString in SQLite or local keychain.

### View drawer / Copy (#8)

- Metadata always visible (name, ARN, description, tags, last changed, version id).
- SecretString area: masked (`••••••••`) by default.
- **Copy value**: Rust `GetSecretValue` → write system clipboard; toast success; UI may stay masked.
- **Reveal**: optional explicit control to show plaintext in the drawer; re-mask on close or after a short TTL.
- List / Describe IPC responses **never** include `SecretString`.

---

## 3. JSON value schema

Recommended shape (all fields optional at parse time; missing fields fall back to
connection metadata or fail at connect if password still absent):

```json
{
  "username": "bi_reader",
  "password": "...",
  "host": "db.internal.example",
  "port": 3306,
  "database": "sales"
}
```

| Field | Type | Notes |
|---|---|---|
| `username` | string | Overrides connection `username` when non-empty |
| `password` | string | Required for a successful dial when `auth_mode=aws_secret` |
| `host` | string | Overrides `host` when non-empty |
| `port` | number | Overrides `port` when present and > 0 |
| `database` | string \| null | Overrides `database` when key present |

Invalid JSON or non-object root → clear connect / test error.

### Naming convention (advisory)

```text
{driver}.{connect_name}
```

Examples: `mysql.sales_ro`, `postgres.bi_warehouse`, `yellowbrick.analytics`.

DBHub secret pickers **may** prefer / highlight names with prefix `{kind}.`, but binding
is always by **ARN**, never by requiring name equality with the connection `name`.

---

## 4. Tags

| Key | Value | When |
|---|---|---|
| `createdBy` | OS user from `get_submit_user()` | Always on Create from this app; never rewritten |
| `lastModifiedBy` | OS user from `get_submit_user()` | Refreshed on every Update from this app |
| `purpose` | e.g. `dbhub` | Optional |

`createdBy` / `lastModifiedBy` are identity tags: the app always writes the local
user and rejects a caller-supplied value naming anyone else. They are attribution,
not access control — see the Attribution rule above. Secrets carrying the legacy
`submitUser` / `managedBy` tags keep them; nothing rewrites or strips them.

Constants live in one Rust module (and mirrored TS constants for UI chips) so filters
and ownership checks stay consistent.

---

## 5. Backend — AWS Secrets Manager

### Dependency

Add `aws-sdk-secretsmanager` to `src-tauri/Cargo.toml` with the same feature set as
sibling SDKs (`behavior-version-latest`, `rt-tokio`, `default-https-client`).

### Module layout

```
src-tauri/src/aws/secrets_manager.rs   // client helpers + mapping
src-tauri/src/commands/secrets_manager.rs
```

Reuse `aws_config_from_account` / active-account runtime (same as STS, S3, Glue).

### Commands (v1)

```
list_secrets() -> Vec<SecretSummary>
  // name, arn, description, tags[], lastChangedDate; NO SecretString
  // scoped to active account region; paginate until complete (cap / warn if huge)

describe_secret(secretId: name|arn) -> SecretDetail
  // metadata only

get_secret_value_for_copy(secretId) -> { clipboardOk: true }
  // GetSecretValue in Rust, write clipboard via Tauri clipboard API;
  // do not return SecretString to the WebView if clipboard path works.
  // Fallback: return value once only if clipboard unavailable (document risk).

get_secret_value_for_reveal(secretId) -> { value: string }
  // Explicit reveal path; frontend must not cache in React Query beyond the drawer.

create_secret(input: { name, description?, secretString, tags? }) -> SecretSummary
  // Merge required tag createdBy=get_submit_user(); reject a caller-supplied
  // createdBy/lastModifiedBy naming anyone else.
```

All commands use the **active** AWS account unless an explicit `accountId` is passed
(follow existing credential command conventions).

### IAM (document in UI empty/error state)

Minimum for v1:

- `secretsmanager:ListSecrets`
- `secretsmanager:DescribeSecret`
- `secretsmanager:GetSecretValue`
- `secretsmanager:CreateSecret`
- `secretsmanager:TagResource` (if tags are applied as a separate step)

Map `AccessDenied` / missing region to actionable copy (which actions are needed).

### Security rules (align with existing app)

- SecretString never appears in list responses, SQLite, MCP tool results, or audit
  payloads beyond “accessed secret arn=…”.
- Prefer clipboard-only copy so the WebView does not retain the value in query cache.
- Create/Update always stamp the local user into `createdBy` / `lastModifiedBy`; the UI
  cannot attribute a write to another user.

---

## 6. DBHub binding

### Schema migration (`db_connections`)

Additive columns (same pattern as `allow_writes`):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `auth_mode` | text | `'manual'` | `manual` \| `aws_secret` |
| `secret_arn` | text null | null | Bound SM ARN |
| `secret_name` | text null | null | Display cache only; reconnect uses ARN |

Constraints (Rust validate on write):

- `auth_mode=manual` → `secret_arn` must be null; password still optional-on-update via local keychain.
- `auth_mode=aws_secret` → `secret_arn` required; local `db/{id}/password` may be absent.
- Changing display `name` never clears or renames `secret_arn`.

Deleting an AWS account still cascades local connection rows; **does not** delete SM
secrets in AWS (shared cloud resource).

### Connection form (`ConnectionFormDialog`)

```
Authentication
  ○ Manual password          // existing keychain path
  ● AWS Secrets Manager
        Secret [ picker ▼ ]  // list_secrets; optional prefer {kind}.* prefix
        Link: Open Secrets page
```

When `aws_secret` is selected:

- Password field hidden (or disabled with helper text).
- Host / port / username / database remain editable as **fallbacks**; non-empty JSON
  fields override at dial time.
- Test / Save use the same resolve path as runtime dial.

### Resolve order (Rust session / test)

1. Load connection row (metadata).
2. If `auth_mode=aws_secret`: `GetSecretValue(secret_arn)` → parse JSON → overlay
   non-empty fields onto a dial config.
3. If `auth_mode=manual`: read local `db/{id}/password` as today.
4. Build DSN / driver connect; never return password to list APIs.

Errors: secret not found, access denied, invalid JSON, missing password after merge.

### Overview card

Show auth badge: `Manual` vs `SM: {secret_name or arn suffix}` so operators see binding
without opening the form.

---

## 7. Boundary vs local `secrets.rs`

| Store | Contents | Secrets sidebar |
|---|---|---|
| AWS Secrets Manager | Shared JSON DB / app secrets | Yes |
| Local keychain / store | AK/SK, LLM, SSH, DBHub manual password | No |

Naming collision note: Rust module `secrets.rs` stays the local credential backend;
AWS module is `aws::secrets_manager` / commands `*_secrets_manager` to avoid confusion.

---

## 8. i18n

- Navigation keys for label + description (EN source strings in `pageMeta`, ZH in
  `navigation.ts`).
- Feature shard `zh/secrets.ts` (or under a dedicated page dictionary) for list,
  create, copy, reveal, IAM errors, DBHub auth-mode labels.
- Coverage tests: every nav label/description must have a ZH entry (existing pattern).

---

## 9. Phasing

| Phase | Scope |
|---|---|
| **P0** | Nav + Secrets page List/Describe + Create (auto `createdBy`) + Copy (+ Reveal) + IAM errors + i18n |
| **P1** | DBHub `auth_mode` / `secret_arn` columns + form picker + dial/test resolve from JSON |
| **P2** | Mine filter polish, Update value (+ `lastModifiedBy`), Delete for any listed secret, optional Create-from-DBHub shortcut |

---

## 10. Acceptance

### P0

- Sidebar shows Secrets (ZH: 密钥管理) above Settings; Mod+N order includes it.
- With a valid account: list shows account-region secrets; Create writes SM secret with
  the `createdBy` tag.
- List/Describe responses never contain plaintext values; Copy places value on clipboard;
  Reveal is opt-in and masked by default.
- Denied IAM surfaces a clear message listing required actions.

### P1

- New/edit connection can select `AWS Secrets Manager`, bind an ARN, save without local password.
- Test/connect overlays JSON fields; changing connection `name` leaves ARN binding intact.
- Manual connections unchanged; both modes coexist on the same account.
- User B can bind a secret created by user A (different `createdBy` tag).

### P2 (later)

- User B can update a secret created by user A; the write refreshes `lastModifiedBy`
  to B and leaves `createdBy=A`. Edit/Delete are enabled on every listed secret.
- Delete is **double-confirmed**: a dialog states the recovery window, and its red
  button stays disabled until the exact secret name is typed back. Because deletion
  is open to everyone, the dialog — not an ownership check — is the safeguard.
- If `TagResource` is denied, the value still saves and the error says so explicitly.

---

## 11. Open follow-ups (non-blocking)

- Clipboard-only vs one-shot return for Reveal on platforms where clipboard APIs fail.
- Soft cap / virtualized list when an account has thousands of secrets.
- Whether Create dialog should offer a “DBHub template” that pre-fills `purpose=dbhub`
  and a `{kind}.` name prefix from a kind dropdown.
