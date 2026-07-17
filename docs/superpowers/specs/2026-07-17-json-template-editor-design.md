# JSON Template Editor Design

## Goal

Replace the Application Config template Payload JSON `Textarea` with a dedicated CodeMirror editor that provides JSON editing plus lightweight `${variable}` template support (highlight, autocomplete, unknown-variable warnings).

## Context

- Templates page tabs: Application Config + Resource Templates.
- Only Application Config's `payloadTemplate` needs a code editor.
- Payload is EMR submit JSON with placeholders like `"${virtualClusterId}"` and `"${date:YYYY-MM-DD}"` (always inside JSON string literals).
- Project already has `AthenaSqlEditor` as the CodeMirror pattern to mirror; do not extract a shared base in this change.
- Save already validates with `JSON.parse`; unknown variables must not block save.

## Approach

Independent `JsonTemplateEditor` component (mirror `AthenaSqlEditor`), plus pure helper services for variable scan / completion / lint.

## Files

| Path | Role |
|------|------|
| `src/components/templates/JsonTemplateEditor.tsx` | CodeMirror wrapper: JSON lang, theme, gutters, controlled value, variable compartments |
| `src/services/jsonTemplateVariables.ts` | Built-ins, scan `${name}` / `${name:pattern}`, diagnostics, completion candidates |
| `src/services/jsonTemplateVariables.test.ts` | Unit tests for scan / lint / completion |
| `src/components/templates/JsonTemplateEditor.test.tsx` | Component smoke tests |
| `src/pages/ApplicationConfigTemplatesPage.tsx` | Swap Textarea → editor; pass known variable names |
| `package.json` | Add `@codemirror/lang-json` |

## Component API

```tsx
<JsonTemplateEditor
  value={payloadTemplate}
  onChange={setPayloadTemplate}
  knownVariables={string[]} // builtins ∪ non-empty custom variable names
  className="min-h-[280px]"
/>
```

Controlled sync matches `AthenaSqlEditor`:

- Doc changes → `onChange`
- External `value` changes (open dialog / Reset / Import) → replace doc only when different
- `knownVariables` changes → reconfigure completion, decorations, and variable linter via Compartment (do not destroy the view)

## Variable behavior

**Built-in names** (must stay aligned with `templateEngine.buildVariableMap`):

- `template_name`, `virtualClusterId`, `submitUser`, `date`, `datetime`

Define `BUILTIN_TEMPLATE_VARIABLES` in `templateEngine.ts` as the single source of truth (used by `buildVariableMap`). `jsonTemplateVariables.ts` imports that constant for known-set / completion / lint — do not duplicate the list.

**Scan pattern** (same semantics as `templateEngine`):

```ts
/\$\{([a-zA-Z0-9_]+)(?::([^}]+))?\}/g
```

- Highlight and lint use the variable name only; format strings are not validated.
- Empty custom variable names are excluded from the known set.
- Malformed tokens like `${}` are ignored (no completion / no diagnostic).

**Highlight:** `Decoration.mark` on each `${...}` match (distinct from normal JSON string styling).

**Autocomplete:** activate when the cursor is inside an open `${...}` placeholder; candidates are `knownVariables`.

**Lint:**

| Condition | Severity | Blocks Save? |
|-----------|----------|--------------|
| Invalid JSON | `error` | Yes (existing `JSON.parse` on Save) |
| Unknown variable name | `warning` | No |

## Page integration

- Replace Payload JSON `Textarea` inside `JobConfigTemplateDialog` only.
- Keep Reset / Import JSON toolbar and dialog layout (`max-w-4xl`, `min-h-[280px]`).
- Editor chrome: rounded border, mono font, line numbers, active line, lint gutter; theme via CSS variables consistent with `AthenaSqlEditor`.
- Save rules unchanged: invalid JSON toast; empty variable names toast; unknown-variable warnings do not block.

## Testing

- Service tests: scan matches, known vs unknown diagnostics, completion candidate set.
- Component tests: render, `onChange` on edit, unknown-variable warning surfaces.
- Update `ApplicationConfigTemplatesPage` tests if they assume a textarea (query editor host or mock the editor).

## Out of scope

- Shared CodeMirror base refactor for SQL + JSON
- Resource Templates form changes
- Format JSON button, fullscreen, folding outline
- Strict mode that blocks save on unknown variables
- Validating `${date:...}` / `${datetime:...}` format patterns
