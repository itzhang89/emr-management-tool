# JSON Template Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Application Config Payload JSON `Textarea` with a CodeMirror `JsonTemplateEditor` that supports JSON highlighting/lint plus `${variable}` highlight, autocomplete, and unknown-variable warnings.

**Architecture:** Mirror `AthenaSqlEditor`: a dedicated React wrapper around CodeMirror 6, with pure helpers in `jsonTemplateVariables.ts` for scan/lint/completion. Built-in variable names live in `templateEngine.ts` as the single source of truth. Unknown variables are lint warnings only; Save still uses `JSON.parse`.

**Tech Stack:** React 19, CodeMirror 6 (`@codemirror/lang-json`, existing `@codemirror/*`), Vitest + Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-07-17-json-template-editor-design.md`

## Global Constraints

- Independent `JsonTemplateEditor` only — do not extract a shared CodeMirror base with SQL.
- Built-ins: `template_name`, `virtualClusterId`, `submitUser`, `date`, `datetime` — defined once in `templateEngine.ts`.
- Scan pattern semantics: `/\$\{([a-zA-Z0-9_]+)(?::([^}]+))?\}/g`
- Unknown variables → warning, never block Save.
- Invalid JSON → editor error diagnostics + existing Save `JSON.parse` toast.
- Do not change Resource Templates.
- No Format JSON button, fullscreen, or folding outline.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/services/templateEngine.ts` | Export `BUILTIN_TEMPLATE_VARIABLES` + `TEMPLATE_VARIABLE_PATTERN`; use them in `buildVariableMap` / `replaceTemplateVariables` |
| `src/services/jsonTemplateVariables.ts` | Scan matches, known-set builder, unknown-variable diagnostics, completion source factory |
| `src/services/jsonTemplateVariables.test.ts` | Unit tests for helpers |
| `src/components/templates/JsonTemplateEditor.tsx` | CodeMirror UI: json lang, theme, decorations, lint, autocomplete, controlled value |
| `src/components/templates/JsonTemplateEditor.test.tsx` | Mount + onChange smoke tests |
| `src/pages/ApplicationConfigTemplatesPage.tsx` | Swap Textarea → editor; pass known variables |
| `package.json` / lockfile | Add `@codemirror/lang-json` |

Reference implementation for CodeMirror React lifecycle: `src/components/glue/AthenaSqlEditor.tsx`.

---

### Task 1: Built-in variables + shared pattern in templateEngine

**Files:**
- Modify: `src/services/templateEngine.ts`
- Modify: `src/services/templateEngine.test.ts` (add one assertion if useful; existing resolve tests already cover behavior)

**Interfaces:**
- Consumes: none new
- Produces:
  - `export const BUILTIN_TEMPLATE_VARIABLES = ["template_name", "virtualClusterId", "submitUser", "date", "datetime"] as const`
  - `export type BuiltinTemplateVariable = (typeof BUILTIN_TEMPLATE_VARIABLES)[number]`
  - `export const TEMPLATE_VARIABLE_PATTERN = /\$\{([a-zA-Z0-9_]+)(?::([^}]+))?\}/g`
  - `buildVariableMap` must initialize keys from `BUILTIN_TEMPLATE_VARIABLES` (values still from context / date helpers)

- [ ] **Step 1: Write a failing test for the exported built-in list**

Add to `src/services/templateEngine.test.ts`:

```ts
import { BUILTIN_TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_PATTERN } from "./templateEngine";

it("exports built-in template variables and a reusable scan pattern", () => {
  expect([...BUILTIN_TEMPLATE_VARIABLES]).toEqual([
    "template_name",
    "virtualClusterId",
    "submitUser",
    "date",
    "datetime"
  ]);
  TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
  expect(TEMPLATE_VARIABLE_PATTERN.test("${ENV}")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/templateEngine.test.ts -t "exports built-in"`

Expected: FAIL — `BUILTIN_TEMPLATE_VARIABLES` / `TEMPLATE_VARIABLE_PATTERN` not exported.

- [ ] **Step 3: Implement exports and wire `buildVariableMap` / `replaceTemplateVariables`**

In `src/services/templateEngine.ts`:

```ts
export const BUILTIN_TEMPLATE_VARIABLES = [
  "template_name",
  "virtualClusterId",
  "submitUser",
  "date",
  "datetime"
] as const;

export type BuiltinTemplateVariable = (typeof BUILTIN_TEMPLATE_VARIABLES)[number];

export const TEMPLATE_VARIABLE_PATTERN = /\$\{([a-zA-Z0-9_]+)(?::([^}]+))?\}/g;
```

Remove the private `VARIABLE_PATTERN` constant. Use `TEMPLATE_VARIABLE_PATTERN` in `replaceTemplateVariables`.

In `buildVariableMap`, keep the same values, but structure so built-in keys are exactly those five names (comment that list must match `BUILTIN_TEMPLATE_VARIABLES`). Preferred shape:

```ts
const variables: Record<string, string> = {
  template_name: context.templateName,
  virtualClusterId: context.virtualClusterId,
  submitUser: context.submitUser,
  date: formatWithPattern(now, defaultFormatForVariableType("date")),
  datetime: formatWithPattern(now, defaultFormatForVariableType("dateTime"))
};
// Ensure compile-time drift check:
void (0 as unknown as Record<BuiltinTemplateVariable, string> & typeof variables);
```

Simpler acceptable approach: iterate `BUILTIN_TEMPLATE_VARIABLES` is awkward for different value sources — instead add a unit test that `Object.keys(buildVariableMap(...)).filter(k => BUILTIN...)` or assert:

```ts
for (const name of BUILTIN_TEMPLATE_VARIABLES) {
  expect(variables).toHaveProperty(name);
}
```

inside an existing resolve test, OR after building the map in a small new test. Do not invent a complex factory.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/services/templateEngine.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/templateEngine.ts src/services/templateEngine.test.ts
git commit -m "$(cat <<'EOF'
refactor: export built-in template variables and scan pattern

Give JsonTemplateEditor a single source of truth shared with template resolution.
EOF
)"
```

---

### Task 2: `jsonTemplateVariables` helpers (TDD)

**Files:**
- Create: `src/services/jsonTemplateVariables.ts`
- Create: `src/services/jsonTemplateVariables.test.ts`

**Interfaces:**
- Consumes: `BUILTIN_TEMPLATE_VARIABLES`, `TEMPLATE_VARIABLE_PATTERN` from `@/services/templateEngine`
- Produces:
  - `export interface TemplateVariableMatch { from: number; to: number; name: string; raw: string }`
  - `export interface TemplateVariableDiagnostic { from: number; to: number; severity: "warning"; message: string }`
  - `export function scanTemplateVariables(text: string): TemplateVariableMatch[]`
  - `export function buildKnownTemplateVariables(customNames: string[]): string[]`
  - `export function diagnoseUnknownTemplateVariables(text: string, knownVariables: string[]): TemplateVariableDiagnostic[]`
  - `export function createTemplateVariableCompletion(getKnown: () => string[]): CompletionSource`

- [ ] **Step 1: Write failing unit tests**

Create `src/services/jsonTemplateVariables.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildKnownTemplateVariables,
  diagnoseUnknownTemplateVariables,
  scanTemplateVariables
} from "./jsonTemplateVariables";
import { BUILTIN_TEMPLATE_VARIABLES } from "./templateEngine";

describe("jsonTemplateVariables", () => {
  it("scans plain and patterned placeholders", () => {
    const text = '"${virtualClusterId}" "${date:YYYY-MM-DD}" "${}"';
    const matches = scanTemplateVariables(text);
    expect(matches.map((m) => m.name)).toEqual(["virtualClusterId", "date"]);
    expect(matches[1]?.raw).toBe("${date:YYYY-MM-DD}");
  });

  it("builds known set from builtins and non-empty custom names", () => {
    expect(buildKnownTemplateVariables(["ENV", "", "  ", "JOB"])).toEqual([
      ...BUILTIN_TEMPLATE_VARIABLES,
      "ENV",
      "JOB"
    ]);
  });

  it("warns on unknown variables only", () => {
    const text = '{"a":"${virtualClusterId}","b":"${missing}"}';
    const known = buildKnownTemplateVariables([]);
    const diagnostics = diagnoseUnknownTemplateVariables(text, known);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("missing");
    expect(diagnostics[0]?.severity).toBe("warning");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/services/jsonTemplateVariables.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers**

Create `src/services/jsonTemplateVariables.ts`:

```ts
import { type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { BUILTIN_TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_PATTERN } from "@/services/templateEngine";

export interface TemplateVariableMatch {
  from: number;
  to: number;
  name: string;
  raw: string;
}

export interface TemplateVariableDiagnostic {
  from: number;
  to: number;
  severity: "warning";
  message: string;
}

export function scanTemplateVariables(text: string): TemplateVariableMatch[] {
  const matches: TemplateVariableMatch[] = [];
  const pattern = new RegExp(TEMPLATE_VARIABLE_PATTERN.source, "g");
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    matches.push({
      from: match.index,
      to: match.index + match[0].length,
      name,
      raw: match[0]
    });
  }
  return matches;
}

export function buildKnownTemplateVariables(customNames: string[]): string[] {
  const custom = customNames.map((n) => n.trim()).filter(Boolean);
  return [...BUILTIN_TEMPLATE_VARIABLES, ...custom];
}

export function diagnoseUnknownTemplateVariables(
  text: string,
  knownVariables: string[]
): TemplateVariableDiagnostic[] {
  const known = new Set(knownVariables);
  return scanTemplateVariables(text)
    .filter((match) => !known.has(match.name))
    .map((match) => ({
      from: match.from,
      to: match.to,
      severity: "warning" as const,
      message: `Unknown template variable: ${match.name}`
    }));
}

export function createTemplateVariableCompletion(getKnown: () => string[]): CompletionSource {
  return (context: CompletionContext) => {
    const before = context.matchBefore(/\$\{[a-zA-Z0-9_]*$/);
    if (!before) return null;
    const typed = before.text.slice(2); // after `${`
    const options: Completion[] = getKnown()
      .filter((name) => name.toLowerCase().startsWith(typed.toLowerCase()))
      .map((name) => ({
        label: name,
        type: "variable",
        apply: `\${${name}}`
      }));
    return {
      from: before.from,
      options,
      validFor: /^\$\{[a-zA-Z0-9_]*$/
    };
  };
}
```

Notes:
- Always clone the regex with `new RegExp(..., "g")` before `matchAll` / `test` so `lastIndex` cannot leak.
- Completion replaces from `${` through the typed prefix with `\${name}` (full placeholder).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/services/jsonTemplateVariables.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/jsonTemplateVariables.ts src/services/jsonTemplateVariables.test.ts
git commit -m "$(cat <<'EOF'
feat: add JSON template variable scan, lint, and completion helpers

Support highlight and autocomplete for ${var} placeholders in payload templates.
EOF
)"
```

---

### Task 3: `JsonTemplateEditor` component

**Files:**
- Create: `src/components/templates/JsonTemplateEditor.tsx`
- Create: `src/components/templates/JsonTemplateEditor.test.tsx`
- Modify: `package.json` (and lockfile via npm install)

**Interfaces:**
- Consumes: helpers from Task 2; CodeMirror APIs; `cn` from `@/lib/utils`
- Produces:
  - `export function JsonTemplateEditor(props: { value: string; onChange: (value: string) => void; knownVariables: string[]; className?: string; readOnly?: boolean }): JSX.Element`

- [ ] **Step 1: Install `@codemirror/lang-json`**

Run:

```bash
npm install @codemirror/lang-json@^6
```

Expected: dependency added alongside existing `@codemirror/*` packages.

- [ ] **Step 2: Write failing component smoke test**

Create `src/components/templates/JsonTemplateEditor.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JsonTemplateEditor } from "./JsonTemplateEditor";

describe("JsonTemplateEditor", () => {
  it("renders an accessible editor and reports document changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JsonTemplateEditor
        value='{"name":"${template_name}"}'
        onChange={onChange}
        knownVariables={["template_name"]}
      />
    );

    const editor = screen.getByRole("textbox", { name: /payload json/i });
    expect(editor).toBeInTheDocument();

    // Focus content and type — CodeMirror uses contenteditable
    await user.click(editor);
    await user.keyboard(" ");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});
```

If `getByRole("textbox")` is flaky with CodeMirror in jsdom, set `aria-label="Payload JSON"` on the host `div` via `EditorView.contentAttributes` or a wrapping element with `role="textbox"` / labelled host — prefer:

```tsx
<div
  ref={containerRef}
  role="textbox"
  aria-label="Payload JSON"
  aria-multiline="true"
  className={cn("json-template-editor ...", className)}
/>
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/components/templates/JsonTemplateEditor.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `JsonTemplateEditor`**

Create `src/components/templates/JsonTemplateEditor.tsx` modeled on `AthenaSqlEditor.tsx`:

Required extensions:
- `lineNumbers()`, `drawSelection()`, `highlightActiveLine()`, `history()`
- `keymap.of([...defaultKeymap, ...historyKeymap])`
- `json()` from `@codemirror/lang-json`
- `linter(jsonParseLinter())` + `lintGutter()` from `@codemirror/lang-json` / `@codemirror/lint`
- Variable linter: `linter((view) => diagnoseUnknownTemplateVariables(view.state.doc.toString(), knownRef.current).map(...))`
- Decoration: `ViewPlugin` / `EditorView.decorations` building `Decoration.mark({ class: "cm-template-variable" })` for each `scanTemplateVariables` match
- `autocompletion({ activateOnTyping: true, override: [createTemplateVariableCompletion(() => knownRef.current)] })`
- Theme similar to Athena (CSS variables); add `.cm-template-variable` color distinct from normal strings (e.g. stronger accent)
- `tooltips({ parent: document.body })`
- Compartments for: `variables` (lint + completion + decorations) and `readOnly`
- `updateListener` → `onChangeRef.current(doc)`
- External `value` sync: if `view.state.doc.toString() !== value`, dispatch full replace
- When `knownVariables` changes, reconfigure the variables compartment

Import `json` and `jsonParseLinter` from `@codemirror/lang-json`.

Keep the component self-contained — do not import from `AthenaSqlEditor`.

- [ ] **Step 5: Run component + helper tests**

Run: `npm test -- src/components/templates/JsonTemplateEditor.test.tsx src/services/jsonTemplateVariables.test.ts`

Expected: PASS. If keyboard typing is unreliable in jsdom, fall back to dispatching a CodeMirror change via a test-only approach: expose nothing; instead use `document.querySelector(".cm-content")` and `user.type`, or call `onChange` by simulating InputEvent. Worst case, reduce the test to “renders labelled host and shows initial doc text in `.cm-content`” plus keep helper tests as the strong coverage.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/templates/JsonTemplateEditor.tsx src/components/templates/JsonTemplateEditor.test.tsx
git commit -m "$(cat <<'EOF'
feat: add JsonTemplateEditor with JSON and template variable support

Provide CodeMirror editing for Application Config payload templates.
EOF
)"
```

---

### Task 4: Wire editor into Application Config dialog

**Files:**
- Modify: `src/pages/ApplicationConfigTemplatesPage.tsx`
- Modify: `src/pages/ApplicationConfigTemplatesPage.test.tsx` (only if needed)

**Interfaces:**
- Consumes: `JsonTemplateEditor`, `buildKnownTemplateVariables`
- Produces: dialog Payload field uses editor; known variables update with `customVariables`

- [ ] **Step 1: Replace Textarea with JsonTemplateEditor**

In `JobConfigTemplateDialog` (`ApplicationConfigTemplatesPage.tsx`):

1. Import:

```ts
import { JsonTemplateEditor } from "@/components/templates/JsonTemplateEditor";
import { buildKnownTemplateVariables } from "@/services/jsonTemplateVariables";
```

2. Remove `Textarea` import if unused elsewhere in the file (check variable description fields — they may still use Input/Textarea; keep if still needed).

3. Replace the Payload `Textarea` block (~lines 321–326) with:

```tsx
<JsonTemplateEditor
  value={payloadTemplate}
  onChange={setPayloadTemplate}
  knownVariables={buildKnownTemplateVariables(customVariables.map((variable) => variable.name))}
  className="min-h-[280px]"
/>
```

4. Leave Reset / Import / Save validation unchanged.

- [ ] **Step 2: Run page tests**

Run: `npm test -- src/pages/ApplicationConfigTemplatesPage.test.tsx`

Expected: PASS. Existing tests do not assert on the payload textarea; they use Import/Reset/variable UI. If anything fails due to CodeMirror in dialog, mock:

```ts
vi.mock("@/components/templates/JsonTemplateEditor", () => ({
  JsonTemplateEditor: ({
    value,
    onChange
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea aria-label="Payload JSON" value={value} onChange={(e) => onChange(e.target.value)} />
  )
}));
```

Prefer real editor if tests stay green; mock only if jsdom + Dialog is unstable.

- [ ] **Step 3: Manual sanity checklist (quick)**

Start app if convenient (`npm run tauri -- dev` or `npm run dev`): open Templates → Application Config → Create/Edit → confirm JSON highlight, `${` autocomplete, unknown var warning, Save still blocked only on invalid JSON.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ApplicationConfigTemplatesPage.tsx src/pages/ApplicationConfigTemplatesPage.test.tsx
git commit -m "$(cat <<'EOF'
feat: use JsonTemplateEditor for application config payloads

Replace the plain textarea so template editing gets JSON and variable assistance.
EOF
)"
```

---

### Task 5: Full verification

**Files:** none expected (fix-only)

- [ ] **Step 1: Run full unit test suite**

Run: `npm test`

Expected: PASS

- [ ] **Step 2: Run TypeScript build**

Run: `npx tsc --noEmit`

Expected: exit 0 (or project’s usual `npm run build` if preferred; `tsc` alone is enough for typecheck)

- [ ] **Step 3: Fix any failures**

If failures appear, fix in the owning task’s files; do not expand scope.

- [ ] **Step 4: Final commit only if fixes were needed**

```bash
git add -A
git status # ensure no secrets
git commit -m "$(cat <<'EOF'
fix: stabilize JsonTemplateEditor tests and types

EOF
)"
```

Skip this commit if Step 1–2 already passed cleanly.

---

## Self-Review

1. **Spec coverage:** Built-ins + pattern (Task 1), scan/lint/completion (Task 2), editor UI (Task 3), page wire-up (Task 4), acceptance via tests (Task 5). Out-of-scope items not scheduled.
2. **Placeholders:** None — concrete paths, APIs, and commands included.
3. **Type consistency:** `knownVariables: string[]`, `buildKnownTemplateVariables`, `JsonTemplateEditor` props match the design API.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-json-template-editor.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
