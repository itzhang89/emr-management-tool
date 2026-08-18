# Source Submit & Resubmit Design

## Goal

Add a **Source submit** mode on Submit Job (edit EMR `StartJobRun` JSON with highlighting and the same field validation as template submit). Rename Job History **Rerun** to **Resubmit**, support **FAILED** and **CANCELLED**, and when no local `sourceRequest` exists, load DescribeJobRun into Source mode after stripping EMR read-only fields.

## Context

- Submit Job today: template + custom variables + resource preset → `validateSubmitPayload` → `toStartJobRunRequest`.
- Job History / submission panel already show **Rerun** for `FAILED` only when `sourceRequest` is present; otherwise toast and stop.
- `JsonTemplateEditor` already provides CodeMirror + JSON highlighting (with optional `${var}` features for Application Config templates).
- Clone via `sessionStore.clonedJobRequest` already navigates configuration into Submit Job (separate from Resubmit; clone may still append `-copy` — out of scope to unify).

## Decisions (confirmed)

| Topic | Choice |
|-------|--------|
| Submit UX | Mode toggle: Template submit \| Source submit |
| Source JSON shape | EMR `StartJobRun` request body |
| Runtime in source mode | Keep Virtual Cluster + Resource Template; both update JSON live |
| Resubmit states | `FAILED` and `CANCELLED` |
| Has `sourceRequest` | Submit immediately; keep original `name` |
| No `sourceRequest` | Describe → whitelist → navigate Submit Source mode; user confirms |
| Describe field policy | Whitelist keep-list (not blacklist-only) |
| Job name on Resubmit | Reuse original name |
| sparkSql | Not supported for Describe→Source path (toast) |
| tags | Dropped on Describe→Source |
| Source → Template switch | If source not from template: confirm dialog with Discard / Cancel / Create template |
| Create template from source | Dialog for name; `payloadTemplate` = current JSON; empty `customVariables`; then switch to Template mode with new template selected |

## Approach

Dual-mode Submit Job page plus a small payload utility module and session bridge for Resubmit-without-source. Reuse validation, resource override, and CodeMirror JSON editing. Do not make JSON the single source of truth for Template mode (avoids large bidirectional sync rewrite).

## Submit Job UI

### Mode toggle

- Segmented control: **Template submit** | **Source submit** (default: Template).
- Shared header **Submit** action (and existing Mod+Enter).
- **Preview JSON**: hide in Source mode (editor is the payload). Keep in Template mode.

### Template mode

Unchanged: template select, custom variables, VC, resource template, resolve → override → validate → submit.

### Source mode

- Left: JSON editor (JSON highlight; **no** `${var}` highlight/completion/lint).
- Right: Virtual Cluster + Resource Template (same as today).
- Initial editor value when entering Source without pending payload: `{}` (no draft persistence in v1).
- Entering from Resubmit pending payload: force Source mode, set editor JSON, sync VC selector.

### Runtime → JSON live sync

When Virtual Cluster or Resource Template changes in Source mode:

1. If editor text is not valid JSON → do not mutate editor; toast that JSON must be fixed first.
2. Else parse object → set `virtualClusterId` (VC change) and/or run `applyResourceOverride` (resource change) → pretty-print back into editor.

### Template → Source

Prefill editor with current resolved template payload after resource override. If resolve fails, use `{}`. Mark `sourceOrigin = "template"`.

### Source → Template

Track `sourceOrigin`: `"template"` | `"external"`.

- **v1 `sourceOrigin` rules:**
  - `"template"` only when entering Source via Template→Source with a successfully resolved (or `{}` fallback) prefill from the current template path.
  - `"external"` when consuming Resubmit `pendingSourceSubmit`, or when Source is entered without a template-derived prefill.
  - Manual edits in the editor do **not** flip `"template"` → `"external"` in v1 (keeps switching back to Template cheap).
  - After **Create template and switch** succeeds, set `"template"` (then leave Source).
- If `sourceOrigin === "template"`: switch to Template mode immediately (discard editor; form uses selected template as today).
- If `sourceOrigin === "external"`: show confirm dialog:
  - **Cancel** — stay in Source mode.
  - **Discard and switch** — clear editor, enter Template mode.
  - **Create template and switch** — open create-template dialog (see below); on success enter Template mode with new template selected; content preserved as `payloadTemplate`.

### Create template from source

- Dialog fields: template **name** (required); optional description if the existing create API/UI already supports it.
- Persist via existing `createJobConfigTemplate`:
  - `payloadTemplate`: current editor text (must be valid JSON before enable/save)
  - `customVariables`: `[]`
  - `defaultResourceTemplateId`: currently selected resource template id
- On success: select new template, set mode to Template, `sourceOrigin = "template"`, close dialogs.
- On failure: stay on dialog; do not change mode.

## Resubmit (Job History & Submit recent panel)

### Button

- Label: **Resubmit** (replace Rerun).
- Visible when `job.state === "FAILED" || job.state === "CANCELLED"`.

### Path A — local `sourceRequest` present

- `startJob.mutate(job.sourceRequest)` immediately.
- Do not rename, do not navigate, do not open editor.
- Success toast: e.g. `Resubmit submitted.`

### Path B — no `sourceRequest`

1. Load DescribeJobRun (use cached describe details if already complete; otherwise fetch).
2. If job driver is sparkSql (or not sparkSubmit): toast that Source Resubmit supports sparkSubmit only; abort.
3. Build whitelist StartJobRun JSON via `describeJobToStartJobPayload`.
4. Store `sessionStore.pendingSourceSubmit = { payload, virtualClusterId }` and navigate to Submit Job.
5. Submit Job consumes pending on mount: force Source mode, set editor, sync VC, clear pending, `sourceOrigin = "external"`.
6. User reviews and clicks Submit (validation applies).

Describe failure: toast; remain on History.

## Describe → whitelist payload

### Keep

- `name` (original job name)
- `virtualClusterId`
- `executionRoleArn`
- `releaseLabel`
- `jobDriver.sparkSubmitJobDriver` — map from describe flat driver:
  - `entryPoint`, `entryPointArguments`, `sparkSubmitParameters`
- `configurationOverrides` (including `applicationConfiguration` and `monitoringConfiguration` when present)
- `retryPolicy` only if present on describe and representable for StartJobRun; otherwise omit

### Drop

- `id`, `arn`, `state`, `createdAt`, `startedAt`, `finishedAt`, `durationSeconds`
- `stateDetails`, `failureReason`, `clientToken`, `createdBy`
- `tags`, `retryCurrentAttemptCount`, and any other read-only/runtime fields

### Driver shape in editor

```json
"jobDriver": {
  "sparkSubmitJobDriver": {
    "entryPoint": "...",
    "entryPointArguments": [],
    "sparkSubmitParameters": "..."
  }
}
```

## Source submit validation & submit pipeline

1. `JSON.parse` editor text — on failure, toast invalid JSON; stop.
2. Treat parsed object as `ResolvedJobPayload`-compatible shape.
3. `validateSubmitPayload(payload)` **without** custom-variable required checks (pass empty custom variable defs/values).
4. Same rules as template path for: name (required, ≤64, EMR charset), `virtualClusterId`, `executionRoleArn`, `releaseLabel`, Spark entryPoint required and `s3://`, no unresolved `${...}` placeholders.
5. Convert with `toStartJobRunRequest(payload, selectedResources)` (or shared helper). Prefer applying `applyResourceOverride` once more immediately before convert so a failed earlier live sync cannot leave resources stale.
6. `startJobRun.mutateAsync(request)`; on success clear any clone/pending source state as appropriate and enable submission history auto-refresh (existing behavior).

## Architecture

```
Template mode: template+vars+resources → resolve → validate → StartJobRunRequest → API

Source mode:   editor JSON ←→ VC/Resource live writeback
               → parse → validateSubmitPayload → toStartJobRunRequest → API

Resubmit+sourceRequest → StartJobRunRequest → API

Resubmit no source → Describe → whitelist → session.pendingSourceSubmit
                   → Submit (Source) → user Submit → Source pipeline
```

### Files (expected)

| Path | Role |
|------|------|
| `src/services/startJobPayload.ts` | Describe→whitelist; parse helpers; thin validate/submit adapters |
| `src/services/startJobPayload.test.ts` | Unit tests for whitelist + parse/validate edges |
| `src/components/emr/JobSourceJsonEditor.tsx` **or** `JsonTemplateEditor` flag | Pure JSON CodeMirror editor for Source mode |
| `src/stores/sessionStore.ts` | `pendingSourceSubmit` + setter/clear |
| `src/pages/SubmitJobPage.tsx` | Mode toggle, source state, dialogs, consume pending |
| `src/components/emr/JobRunsPanel.tsx` | Resubmit label, states, dual paths, navigate |
| `src/pages/JobHistoryPage.test.tsx` / `SubmitJobPage.test.tsx` | Behavior coverage |
| Navigation helper / AppShell as needed | Open Submit after Resubmit path B |

Prefer extending `JsonTemplateEditor` with something like `enableTemplateVariables={false}` if that stays small; otherwise a thin `JobSourceJsonEditor` that mirrors JSON-only setup without variable compartments.

## Error handling

| Case | Behavior |
|------|----------|
| Invalid JSON + Runtime change | No editor write; toast |
| Invalid JSON + Submit | Toast; no API call |
| Validation errors | Toast each / first + rest (match existing template submit UX) |
| Describe fails | Toast; stay on History |
| sparkSql Describe Resubmit | Toast unsupported; no navigation |
| Create template fails | Stay in create dialog; mode unchanged |
| Missing required fields after whitelist | Still open Source prefill; Submit validation blocks |

## Out of scope

- Persisting Source-mode drafts across sessions
- Bidirectional Source JSON → custom variable inference
- sparkSql Resubmit / Source submit driver types other than sparkSubmit
- Changing Clone (`-copy`) behavior or removing Clone
- Including `tags` on Resubmit-from-Describe
- Making Template mode always sync into a shared JSON editor (single source of truth)

## Testing (minimum)

- Whitelist: drops id/state/clientToken/tags; keeps name/VC/role/release/jobDriver/configurationOverrides; maps describe driver → `sparkSubmitJobDriver`
- sparkSql describe helper rejects or signals unsupported
- Resubmit UI: button on FAILED and CANCELLED; absent on RUNNING/COMPLETED
- Path A: with `sourceRequest`, calls start with that request and original name
- Path B: without `sourceRequest`, sets pending + navigates (mock)
- Source validate: bad name / missing entryPoint blocked
- Mode switch: external source → Template shows three actions; create-template success selects new template and leaves Source

## Implementation notes

- Keep EMR job name charset message consistent with `templateEngine` (`EMR_JOB_NAME_PATTERN`).
- Reuse `applyResourceOverride` for live resource sync and final submit override.
- Do not strip user-edited `configurationOverrides.monitoringConfiguration` in Source mode; only Describe→whitelist decides initial content.
