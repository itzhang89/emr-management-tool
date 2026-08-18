# Source Submit & Resubmit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Source-mode EMR JSON submit on Submit Job, and replace Rerun with Resubmit for FAILED/CANCELLED jobs (direct submit when `sourceRequest` exists; otherwise Describe→whitelist→Source editor).

**Architecture:** Pure helpers in `startJobPayload.ts` convert Describe details to StartJobRun-shaped JSON and parse/validate source text. Submit Job gains a Template|Source mode toggle with live VC/resource writeback into a JSON-only CodeMirror editor. JobRunsPanel Resubmit either mutates immediately or stores `pendingSourceSubmit` in session and navigates to Submit via `onOpenSubmit`.

**Tech Stack:** React 19, Zustand session store, CodeMirror 6 (`JsonTemplateEditor` / `@codemirror/lang-json`), TanStack Query, Vitest + Testing Library, existing `templateEngine` / `applyResourceOverride`.

**Spec:** `docs/superpowers/specs/2026-08-03-source-submit-and-resubmit-design.md`

## Global Constraints

- Source JSON shape = EMR StartJobRun body (`name`, `virtualClusterId`, `executionRoleArn`, `releaseLabel`, `jobDriver.sparkSubmitJobDriver`, `configurationOverrides`).
- Resubmit visible for `FAILED` and `CANCELLED` only; keep original job `name`.
- Path A (`sourceRequest` present): immediate `startJob.mutate`; no rename / no navigation.
- Path B (no `sourceRequest`): Describe → whitelist → `pendingSourceSubmit` → navigate Submit Source mode.
- sparkSql Describe path: toast unsupported; do not navigate.
- Drop tags / clientToken / runtime fields on Describe→Source; omit retry (backend `start_job_run` does not send retry policy).
- Source submit uses `validateSubmitPayload` without custom-variable required checks.
- Source → Template with `sourceOrigin === "external"`: confirm dialog (Cancel / Discard / Create template).
- Create template: `payloadTemplate` = editor JSON, `customVariables: []`, `defaultResourceTemplateId` = current resource selection.
- Preview JSON hidden in Source mode.
- Do not change Clone (`-copy`) behavior.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/services/startJobPayload.ts` | Describe→whitelist JSON; parse source text; pretty-print; sparkSubmit guard |
| `src/services/startJobPayload.test.ts` | Unit tests for whitelist / parse / unsupported driver |
| `src/stores/sessionStore.ts` | `pendingSourceSubmit` + setter; clear on account reset |
| `src/stores/sessionStore.test.ts` | Pending payload clear/reset coverage |
| `src/components/templates/JsonTemplateEditor.tsx` | Optional `enableTemplateVariables` (default true) |
| `src/components/templates/JsonTemplateEditor.test.tsx` | Smoke for variables-off mode |
| `src/components/emr/JobRunsPanel.tsx` | Resubmit label/states/dual path; `onOpenSubmit` |
| `src/pages/JobHistoryPage.tsx` | Pass `onOpenSubmit` |
| `src/pages/JobHistoryPage.test.tsx` | Resubmit FAILED/CANCELLED + path behaviors |
| `src/components/layout/AppShell.tsx` | `onOpenSubmit` → `navigateToPage("submit")` for History (and Submit panel if needed) |
| `src/pages/SubmitJobPage.tsx` | Mode toggle, source editor, live sync, dialogs, consume pending |
| `src/pages/SubmitJobPage.test.tsx` | Mode / validate / pending consume / switch dialog |

---

### Task 1: Describe → StartJobRun whitelist helpers

**Files:**
- Create: `src/services/startJobPayload.ts`
- Create: `src/services/startJobPayload.test.ts`

**Interfaces:**
- Consumes: `JobRunSummary`, `JobRunDescribeDetails`, `ResolvedJobPayload` from `@/types/domain`
- Produces:
  - `export type StartJobPayloadJson = ResolvedJobPayload` (alias for clarity)
  - `export function isSparkSubmitDescribe(job: JobRunSummary): boolean`
  - `export function describeJobToStartJobPayload(job: JobRunSummary): StartJobPayloadJson`
  - `export function parseSourceJobPayload(text: string): { ok: true; payload: StartJobPayloadJson } | { ok: false; error: string }`
  - `export function formatSourceJobPayload(payload: StartJobPayloadJson): string` — `JSON.stringify(payload, null, 2)`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  describeJobToStartJobPayload,
  formatSourceJobPayload,
  isSparkSubmitDescribe,
  parseSourceJobPayload
} from "./startJobPayload";
import type { JobRunSummary } from "@/types/domain";

function baseJob(overrides: Partial<JobRunSummary> = {}): JobRunSummary {
  return {
    id: "job-1",
    name: "my-job",
    state: "FAILED",
    virtualClusterId: "vc-1",
    createdAt: "2026-01-01T00:00:00Z",
    describeDetails: {
      arn: "arn:aws:emr-containers:...",
      clientToken: "tok",
      executionRoleArn: "arn:aws:iam::123:role/EmrRole",
      releaseLabel: "emr-7.0.0-latest",
      createdBy: "user",
      stateDetails: "failed",
      failureReason: "USER_ERROR",
      tags: { a: "b" },
      retryMaxAttempts: 3,
      retryCurrentAttemptCount: 1,
      jobDriver: {
        type: "sparkSubmit",
        entryPoint: "s3://bucket/app.jar",
        entryPointArguments: ["--env", "prod"],
        sparkSubmitParameters: "--conf spark.executor.cores=2"
      },
      configurationOverrides: {
        applicationConfiguration: [{ classification: "spark-defaults", properties: { "spark.app.name": "x" } }],
        monitoringConfiguration: { s3MonitoringConfiguration: { logUri: "s3://logs/" } }
      }
    },
    ...overrides
  };
}

describe("startJobPayload", () => {
  it("maps describe details to StartJobRun whitelist JSON", () => {
    const payload = describeJobToStartJobPayload(baseJob());
    expect(payload).toEqual({
      name: "my-job",
      virtualClusterId: "vc-1",
      executionRoleArn: "arn:aws:iam::123:role/EmrRole",
      releaseLabel: "emr-7.0.0-latest",
      jobDriver: {
        sparkSubmitJobDriver: {
          entryPoint: "s3://bucket/app.jar",
          entryPointArguments: ["--env", "prod"],
          sparkSubmitParameters: "--conf spark.executor.cores=2"
        }
      },
      configurationOverrides: {
        applicationConfiguration: [{ classification: "spark-defaults", properties: { "spark.app.name": "x" } }],
        monitoringConfiguration: { s3MonitoringConfiguration: { logUri: "s3://logs/" } }
      }
    });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("tags");
    expect(payload).not.toHaveProperty("clientToken");
    expect(JSON.stringify(payload)).not.toContain("retry");
  });

  it("detects sparkSubmit vs sparkSql", () => {
    expect(isSparkSubmitDescribe(baseJob())).toBe(true);
    expect(
      isSparkSubmitDescribe(
        baseJob({
          describeDetails: {
            jobDriver: { type: "sparkSql", sparkSqlParameters: "SELECT 1" }
          }
        })
      )
    ).toBe(false);
  });

  it("throws when describe details or sparkSubmit driver missing", () => {
    expect(() => describeJobToStartJobPayload(baseJob({ describeDetails: undefined }))).toThrow(
      /describe/i
    );
    expect(() =>
      describeJobToStartJobPayload(
        baseJob({
          describeDetails: { jobDriver: { type: "sparkSql", sparkSqlParameters: "SELECT 1" } }
        })
      )
    ).toThrow(/sparkSubmit/i);
  });

  it("parses and formats source JSON", () => {
    const payload = describeJobToStartJobPayload(baseJob());
    const text = formatSourceJobPayload(payload);
    const parsed = parseSourceJobPayload(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.payload.name).toBe("my-job");
    expect(parseSourceJobPayload("{").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/startJobPayload.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers**

```ts
import type { JobRunSummary, ResolvedJobPayload } from "@/types/domain";

export type StartJobPayloadJson = ResolvedJobPayload;

export function isSparkSubmitDescribe(job: JobRunSummary): boolean {
  return job.describeDetails?.jobDriver?.type === "sparkSubmit";
}

export function describeJobToStartJobPayload(job: JobRunSummary): StartJobPayloadJson {
  const details = job.describeDetails;
  if (!details) {
    throw new Error("Job describe details are required.");
  }
  const driver = details.jobDriver;
  if (!driver || driver.type !== "sparkSubmit") {
    throw new Error("Only sparkSubmit jobs can be converted to a StartJobRun payload.");
  }
  if (!details.executionRoleArn?.trim() || !details.releaseLabel?.trim()) {
    // Still build what we can; missing fields are allowed in the object and blocked at submit validation.
  }

  const payload: StartJobPayloadJson = {
    name: job.name,
    virtualClusterId: job.virtualClusterId,
    executionRoleArn: details.executionRoleArn ?? "",
    releaseLabel: details.releaseLabel ?? "",
    jobDriver: {
      sparkSubmitJobDriver: {
        entryPoint: driver.entryPoint ?? "",
        entryPointArguments: driver.entryPointArguments ?? [],
        sparkSubmitParameters: driver.sparkSubmitParameters ?? ""
      }
    }
  };

  if (details.configurationOverrides) {
    payload.configurationOverrides = details.configurationOverrides;
  }

  return payload;
}

export function parseSourceJobPayload(
  text: string
): { ok: true; payload: StartJobPayloadJson } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "Source payload must be a JSON object." };
    }
    return { ok: true, payload: value as StartJobPayloadJson };
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }
}

export function formatSourceJobPayload(payload: StartJobPayloadJson): string {
  return JSON.stringify(payload, null, 2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/services/startJobPayload.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/startJobPayload.ts src/services/startJobPayload.test.ts
git commit -m "$(cat <<'EOF'
feat: add Describe-to-StartJobRun payload whitelist helpers

EOF
)"
```

---

### Task 2: Session pending Source submit bridge

**Files:**
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/stores/sessionStore.test.ts`

**Interfaces:**
- Consumes: `StartJobPayloadJson` from `startJobPayload.ts`
- Produces:
  - `pendingSourceSubmit?: { payload: StartJobPayloadJson; virtualClusterId: string }`
  - `setPendingSourceSubmit(value?: { payload: StartJobPayloadJson; virtualClusterId: string }): void`
  - `resetAccountScopedSession` also clears `pendingSourceSubmit`

- [ ] **Step 1: Write the failing test**

Add to `src/stores/sessionStore.test.ts`:

```ts
it("stores and clears pendingSourceSubmit on account reset", () => {
  const payload = {
    name: "job",
    virtualClusterId: "vc-1",
    executionRoleArn: "arn:role",
    releaseLabel: "emr-7.0.0-latest",
    jobDriver: {
      sparkSubmitJobDriver: {
        entryPoint: "s3://b/a.jar",
        entryPointArguments: [],
        sparkSubmitParameters: ""
      }
    }
  };
  useSessionStore.getState().setPendingSourceSubmit({ payload, virtualClusterId: "vc-1" });
  expect(useSessionStore.getState().pendingSourceSubmit?.payload.name).toBe("job");
  useSessionStore.getState().resetAccountScopedSession();
  expect(useSessionStore.getState().pendingSourceSubmit).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/stores/sessionStore.test.ts -t "pendingSourceSubmit"`

Expected: FAIL — `setPendingSourceSubmit` missing.

- [ ] **Step 3: Extend session store**

In `src/stores/sessionStore.ts`:

- Import `StartJobPayloadJson` from `@/services/startJobPayload`.
- Add `pendingSourceSubmit?: { payload: StartJobPayloadJson; virtualClusterId: string }`.
- Add `setPendingSourceSubmit`.
- Clear `pendingSourceSubmit` inside `resetAccountScopedSession`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/stores/sessionStore.test.ts -t "pendingSourceSubmit"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/sessionStore.ts src/stores/sessionStore.test.ts
git commit -m "$(cat <<'EOF'
feat: add pendingSourceSubmit session bridge for Resubmit

EOF
)"
```

---

### Task 3: JSON editor without template-variable chrome

**Files:**
- Modify: `src/components/templates/JsonTemplateEditor.tsx`
- Modify: `src/components/templates/JsonTemplateEditor.test.tsx`

**Interfaces:**
- Consumes: existing CodeMirror setup
- Produces: `enableTemplateVariables?: boolean` (default `true`). When `false`, skip variable decorations / unknown-var linter / variable autocomplete; still keep `json()` + `jsonParseLinter` + lint gutter. `knownVariables` may be omitted or ignored when disabled — make it optional: `knownVariables?: string[]` with default `[]`.

- [ ] **Step 1: Write a failing smoke test**

```ts
it("supports JSON-only mode without template variable prop requirements", () => {
  render(
    <JsonTemplateEditor
      value='{"a":1}'
      onChange={() => undefined}
      enableTemplateVariables={false}
    />
  );
  expect(screen.getByRole("textbox")).toBeInTheDocument();
});
```

(Adjust query to match existing test patterns for the editor role/label.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/templates/JsonTemplateEditor.test.tsx -t "JSON-only"`

Expected: FAIL on unknown prop / required `knownVariables`.

- [ ] **Step 3: Implement the flag**

In `JsonTemplateEditor`:

```tsx
enableTemplateVariables = true,
knownVariables = [],
```

When creating extensions, only add `compartments.variables.of(createVariableExtensions(...))` when `enableTemplateVariables` is true; otherwise `compartments.variables.of([])`.

Reconfigure effect for knownVariables should no-op when disabled.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/components/templates/JsonTemplateEditor.test.tsx`

Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/components/templates/JsonTemplateEditor.tsx src/components/templates/JsonTemplateEditor.test.tsx
git commit -m "$(cat <<'EOF'
feat: allow JsonTemplateEditor JSON-only mode for Source submit

EOF
)"
```

---

### Task 4: Resubmit in JobRunsPanel (dual path)

**Files:**
- Modify: `src/components/emr/JobRunsPanel.tsx`
- Modify: `src/pages/JobHistoryPage.test.tsx` (and any panel-level tests if present)

**Interfaces:**
- Consumes:
  - `describeJobToStartJobPayload`, `isSparkSubmitDescribe` from `startJobPayload`
  - `emrService.describeJobRun` / existing describe when `job.describeDetails` incomplete
  - `useSessionStore.getState().setPendingSourceSubmit`
  - `useActiveAwsAccount` account id for describe if needed
- Produces:
  - Prop `onOpenSubmit?: () => void`
  - Button label **Resubmit**; shown when `job.state === "FAILED" || job.state === "CANCELLED"`

- [ ] **Step 1: Update / add failing History tests**

In `src/pages/JobHistoryPage.test.tsx`:

1. Rename assertions from `/Rerun/i` → `/Resubmit/i`.
2. Assert Resubmit appears for a CANCELLED row.
3. Keep Path A: job with `sourceRequest` → `startJob` called (mock) with that request.
4. Path B: failed job without `sourceRequest`, with sparkSubmit describeDetails → `setPendingSourceSubmit` called and `onOpenSubmit` invoked (pass prop through page → panel). Mock toast for sparkSql.

Example Path B sketch:

```ts
it("opens Submit Source flow when Resubmit has no sourceRequest", async () => {
  const onOpenSubmit = vi.fn();
  const setPending = vi.fn();
  // mock session store setPendingSourceSubmit
  // job FAILED, sourceRequest undefined, describeDetails sparkSubmit present
  render(<JobHistoryPage onOpenSubmit={onOpenSubmit} />);
  await userEvent.click(screen.getByRole("button", { name: /Resubmit/i }));
  expect(setPending).toHaveBeenCalled();
  expect(onOpenSubmit).toHaveBeenCalled();
});
```

Wire `JobHistoryPage` to accept and forward `onOpenSubmit` in the same change as fixing the compile (minimal page prop pass-through).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/pages/JobHistoryPage.test.tsx -t "Resubmit"`

Expected: FAIL — still Rerun / no CANCELLED / no path B.

- [ ] **Step 3: Implement panel logic**

Replace Rerun block with:

```tsx
{(job.state === "FAILED" || job.state === "CANCELLED") ? (
  <Button
    variant="ghost"
    size="sm"
    disabled={startJob.isPending}
    onClick={() => {
      void handleResubmit(job);
    }}
  >
    <Play data-icon="inline-start" />
    Resubmit
  </Button>
) : null}
```

`handleResubmit`:

```ts
async function handleResubmit(job: JobRunSummary) {
  if (job.sourceRequest) {
    startJob.mutate(job.sourceRequest, {
      onSuccess: () => {
        toast.success("Resubmit submitted.");
        onSubmissionStarted?.();
      },
      onError: (error) => toast.error(errorMessage(error))
    });
    return;
  }

  try {
    let detailed = job;
    if (!job.describeDetails?.jobDriver) {
      detailed = await emrService.describeJobRun(job.id, job.virtualClusterId, accountId);
    }
    if (!isSparkSubmitDescribe(detailed)) {
      toast.error("Source Resubmit currently supports sparkSubmit jobs only.");
      return;
    }
    const payload = describeJobToStartJobPayload(detailed);
    setPendingSourceSubmit({ payload, virtualClusterId: detailed.virtualClusterId });
    onOpenSubmit?.();
  } catch (error) {
    toast.error(formatAppError(error, "Failed to load job for Resubmit."));
  }
}
```

Pass `onOpenSubmit` from `JobHistoryPage` into `JobRunsPanel`. Also pass it from Submit Job's recent `JobRunsPanel` if History-style Resubmit without source should open Source on the same page — call `onOpenSubmit` only when provided; when already on Submit, Submit page can listen to pending in an effect (Task 6) so `onOpenSubmit` may be a no-op or omitted on Submit panel. Prefer: Submit's panel also gets `onOpenSubmit` that is undefined; pending still set — Submit page effect consumes pending while mounted. For History, AppShell must navigate (Task 5).

- [ ] **Step 4: Run tests**

Run: `npm test -- src/pages/JobHistoryPage.test.tsx`

Expected: PASS for updated Resubmit cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/emr/JobRunsPanel.tsx src/pages/JobHistoryPage.tsx src/pages/JobHistoryPage.test.tsx
git commit -m "$(cat <<'EOF'
feat: Resubmit FAILED/CANCELLED via sourceRequest or Describe bridge

EOF
)"
```

---

### Task 5: AppShell navigates to Submit for Path B

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/AppShell.test.tsx` if navigation callbacks are covered; otherwise extend JobHistory wiring test

**Interfaces:**
- Consumes: `navigateToPage("submit")`
- Produces: `<JobHistoryPage onOpenLogs={...} onOpenS3={...} onOpenSubmit={() => navigateToPage("submit")} />`

- [ ] **Step 1: Write / adjust a failing test**

If AppShell tests mock pages, assert `JobHistoryPage` receives `onOpenSubmit`. Otherwise add a thin test that rendering AppShell passes the prop (mock `JobHistoryPage` to capture props).

- [ ] **Step 2: Run test to verify fail/need**

Run: `npm test -- src/components/layout/AppShell.test.tsx`

- [ ] **Step 3: Wire callback**

```tsx
const openSubmitPage = useCallback(() => {
  startPageTransition(() => setActivePage("submit"));
}, [startPageTransition]);

// ...
return <JobHistoryPage onOpenLogs={openLogsPage} onOpenS3={openS3Page} onOpenSubmit={openSubmitPage} />;
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/components/layout/AppShell.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/layout/AppShell.test.tsx
git commit -m "$(cat <<'EOF'
feat: navigate to Submit Job for Resubmit without sourceRequest

EOF
)"
```

---

### Task 6: Submit Job Source mode (toggle, editor, live sync, submit)

**Files:**
- Modify: `src/pages/SubmitJobPage.tsx`
- Modify: `src/pages/SubmitJobPage.test.tsx`

**Interfaces:**
- Consumes:
  - `JsonTemplateEditor` with `enableTemplateVariables={false}`
  - `parseSourceJobPayload`, `formatSourceJobPayload` from `startJobPayload`
  - `applyResourceOverride`, `validateSubmitPayload`, `toStartJobRunRequest`
  - `pendingSourceSubmit` / `setPendingSourceSubmit` from session
- Produces:
  - `mode: "template" | "source"`
  - `sourceJson: string`
  - `sourceOrigin: "template" | "external"`
  - Mode toggle UI; Source left pane = editor; hide Preview in Source
  - Live VC / Resource → JSON writeback
  - Source submit validation path

- [ ] **Step 1: Write failing page tests**

Cover at least:

1. Mode toggle shows Template / Source; Source shows textbox editor.
2. Invalid source JSON blocks submit with toast (mock sonner).
3. Consuming `pendingSourceSubmit` forces Source mode and clears pending.
4. Changing resource template with valid JSON updates `sparkSubmitParameters` / spark-defaults (assert `onChange` text contains resource conf) — can unit-test a small helper extracted in the page file or test via interaction.

Minimal helper to extract in `startJobPayload.ts` or keep inline:

```ts
export function applyRuntimeToSourcePayload(
  payload: StartJobPayloadJson,
  virtualClusterId: string,
  resources: SparkResourceConfig
): StartJobPayloadJson {
  const withCluster = { ...payload, virtualClusterId };
  return applyResourceOverride(withCluster, resources);
}
```

Add unit tests for this in `startJobPayload.test.ts` if extracted (preferred).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/pages/SubmitJobPage.test.tsx`

Expected: FAIL on missing Source mode UI / pending consume.

- [ ] **Step 3: Implement Source mode on SubmitJobPage**

Key behaviors:

```tsx
const [mode, setMode] = useState<"template" | "source">("template");
const [sourceJson, setSourceJson] = useState("{}");
const [sourceOrigin, setSourceOrigin] = useState<"template" | "external">("external");

// consume pending
useEffect(() => {
  if (!pendingSourceSubmit) return;
  setMode("source");
  setSourceOrigin("external");
  setSourceJson(formatSourceJobPayload(pendingSourceSubmit.payload));
  setSelectedVirtualClusterId(pendingSourceSubmit.virtualClusterId);
  setPendingSourceSubmit(undefined);
  toast.success("Loaded job configuration into Source submit.");
}, [pendingSourceSubmit, ...]);
```

Mode toggle using existing `Tabs` / `TabsList` / `TabsTrigger` (or a pair of outline buttons):

- Switching to Source from Template: resolve current template+resources into JSON; `setSourceOrigin("template")`; on resolve failure use `"{}"` and `sourceOrigin = "external"`.
- Switching to Template: if `sourceOrigin === "template"`, switch immediately; if `"external"`, open confirm dialog (implemented in Task 7 — for this task, temporarily block with dialog stub or implement Cancel/Discard only).

**Prefer completing Cancel/Discard in Task 6 and Create-template in Task 7.**

Live sync effect when `mode === "source"` and (`virtualClusterId` or `selectedResources` / `resourceTemplateId`) changes:

```ts
const parsed = parseSourceJobPayload(sourceJson);
if (!parsed.ok) {
  toast.error("Fix JSON before syncing Runtime selection.");
  return;
}
try {
  const next = applyRuntimeToSourcePayload(parsed.payload, virtualClusterId!, selectedResources);
  setSourceJson(formatSourceJobPayload(next));
} catch {
  toast.error("Could not apply resource template to source JSON.");
}
```

Avoid infinite loops: only rewrite when the formatted result differs from current `sourceJson`, and skip the toast on first mount after pending load by tracking a sync generation / comparing previous VC+resource ids.

`validateAndSubmit` when `mode === "source"`:

```ts
const parsed = parseSourceJobPayload(sourceJson);
if (!parsed.ok) {
  toast.error(parsed.error);
  return;
}
const overridden = applyResourceOverride(parsed.payload, selectedResources);
const validation = validateSubmitPayload(overridden);
if (!validation.ok) { /* same toast pattern as template */ return; }
const request = toStartJobRunRequest(overridden, selectedResources);
await startJobRun.mutateAsync(request);
```

Hide Preview button when `mode === "source"`.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/pages/SubmitJobPage.test.tsx`

Expected: PASS for Task 6 cases.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SubmitJobPage.tsx src/pages/SubmitJobPage.test.tsx src/services/startJobPayload.ts src/services/startJobPayload.test.ts
git commit -m "$(cat <<'EOF'
feat: add Source submit mode with live Runtime sync and validation

EOF
)"
```

---

### Task 7: Source → Template confirm + create template

**Files:**
- Modify: `src/pages/SubmitJobPage.tsx`
- Modify: `src/pages/SubmitJobPage.test.tsx`
- Uses: `useCreateJobConfigTemplate` from `@/hooks/useJobConfigTemplates`

**Interfaces:**
- Consumes: `createJobConfigTemplate` mutation; Dialog / AlertDialog primitives already in UI kit
- Produces:
  - Confirm dialog when leaving Source with `sourceOrigin === "external"`: Cancel | Discard and switch | Create template and switch
  - Create-template dialog: name (required), optional description; save builds `JobConfigTemplate`

- [ ] **Step 1: Write failing tests**

```ts
it("prompts before leaving external Source mode for Template", async () => {
  // enter Source with external origin (e.g. via pending or toggle with empty resolve)
  await user.click(screen.getByRole("tab", { name: /Template/i })); // or button
  expect(screen.getByText(/discard/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Create template/i })).toBeInTheDocument();
});

it("creates a template from source JSON and switches to Template mode", async () => {
  const create = vi.fn().mockResolvedValue({ templates: [{ id: "new", name: "From Source", ... }] });
  // mock useCreateJobConfigTemplate
  // open create flow, fill name, save
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "From Source",
      customVariables: [],
      payloadTemplate: expect.stringContaining("\"name\"")
    })
  );
  expect(/* selected template id */).toBe("new");
  expect(/* mode template */).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/pages/SubmitJobPage.test.tsx -t "Source mode"`

Expected: FAIL — dialog / create not implemented.

- [ ] **Step 3: Implement dialogs**

Confirm dialog copy (concise):

- Title: `Switch to Template submit?`
- Body: `Current source JSON was not loaded from a template. Switching discards the editor contents unless you save it as a template.`
- Actions:
  - Cancel
  - Discard and switch → `setMode("template")`, `setSourceJson("{}")`
  - Create template and switch → open second dialog

Create dialog:

```ts
const now = new Date().toISOString();
await createTemplate.mutateAsync({
  id: crypto.randomUUID(),
  name: name.trim(),
  description: description.trim() || undefined,
  payloadTemplate: sourceJson,
  customVariables: [],
  defaultResourceTemplateId: resourceTemplateId,
  builtIn: false,
  createdAt: now,
  updatedAt: now
});
```

Before save: `parseSourceJobPayload(sourceJson)` must be ok.

On success: `setSelectedTemplateId` to new id, `setMode("template")`, `setSourceOrigin("template")`, close dialogs, toast success.

- [ ] **Step 4: Run full related suites**

Run:

```bash
npm test -- src/services/startJobPayload.test.ts src/stores/sessionStore.test.ts src/components/templates/JsonTemplateEditor.test.tsx src/pages/JobHistoryPage.test.tsx src/pages/SubmitJobPage.test.tsx src/components/layout/AppShell.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/SubmitJobPage.tsx src/pages/SubmitJobPage.test.tsx
git commit -m "$(cat <<'EOF'
feat: confirm Source→Template switch and create template from JSON

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Template \| Source mode toggle | 6 |
| EMR StartJobRun JSON + highlight | 3, 6 |
| VC + Resource live writeback | 6 |
| Source field validation | 6 |
| Preview hidden in Source | 6 |
| Resubmit rename + FAILED/CANCELLED | 4 |
| Path A immediate submit, keep name | 4 |
| Path B Describe whitelist → Submit Source | 1, 2, 4, 5, 6 |
| sparkSql unsupported toast | 4 |
| Drop tags / clientToken / runtime fields | 1 |
| Source→Template confirm + create template | 7 |
| Create template empty customVariables | 7 |

## Self-review notes

- No `retryPolicy` in whitelist implementation (backend cannot start with it) — matches spec “omit if not representable”.
- Clone flow untouched.
- Live-sync must guard invalid JSON and missing `jobDriver.sparkSubmitJobDriver` (try/catch around `applyResourceOverride`).
- Submit recent panel Resubmit Path B sets pending; if user is already on Submit, Task 6 effect loads it without AppShell navigation.
