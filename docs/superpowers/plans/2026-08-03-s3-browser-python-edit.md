# S3 Browser Python Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.py` S3 objects editable in the S3 browser with Python syntax highlighting via `@codemirror/lang-python`.

**Architecture:** Extend the shared editable-extension allowlist in TypeScript and Rust, then map `.py` to CodeMirror’s official Python language package in `S3ObjectEditor`. Keep the existing 5 MB preview-only limit.

**Tech Stack:** TypeScript/Vitest, Rust unit tests, CodeMirror 6 (`@codemirror/lang-python`), existing S3 editability helpers.

## Global Constraints

- Only add the `py` suffix (not `.pyi`, `.ipynb`, etc.).
- Use `@codemirror/lang-python` (not legacy-modes python).
- Keep frontend and backend allowlists in sync.
- Do not change the 5 MB editor limit or save/load flows.

---

### Task 1: Allowlist `.py` (frontend + backend)

**Files:**
- Modify: `src/services/s3Rules.ts`
- Modify: `src/services/s3Rules.test.ts`
- Modify: `src-tauri/src/aws/s3_rules.rs`
- Test: `src/services/s3Rules.test.ts`, `src-tauri/src/aws/s3_rules.rs` (inline `#[cfg(test)]`)

**Interfaces:**
- Consumes: existing `getS3ObjectEditability` / `s3_object_editability`
- Produces: `py` treated as editable + previewable when `size ≤ 5 MB`

- [ ] **Step 1: Write the failing frontend test**

In `src/services/s3Rules.test.ts`, inside `allows documented text extensions`, add:

```typescript
expect(getS3ObjectEditability({ key: "scripts/job.py", size: 1024 })).toEqual({
  editable: true,
  previewable: true,
  reason: undefined
});
```

- [ ] **Step 2: Write the failing Rust test**

In `src-tauri/src/aws/s3_rules.rs` `allows_documented_text_extensions`, add:

```rust
let py = s3_object_editability("scripts/job.py", 1024);
assert!(py.editable);
assert!(py.previewable);
assert!(py.reason.is_none());
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/services/s3Rules.test.ts
cd src-tauri && cargo test s3_rules -- --nocapture
```

Expected: frontend assertion fails for `scripts/job.py` (`editable: false`); Rust `py` assertions fail.

- [ ] **Step 4: Minimal implementation**

In `src/services/s3Rules.ts`, add `"py"` to `EDITABLE_EXTENSIONS`:

```typescript
const EDITABLE_EXTENSIONS = new Set([
  "sql", "yaml", "yml", "json", "conf", "properties", "txt", "scala", "sc", "csv", "py"
]);
```

In `src-tauri/src/aws/s3_rules.rs`:

```rust
const EDITABLE_EXTENSIONS: &[&str] = &[
    "sql", "yaml", "yml", "json", "conf", "properties", "txt", "scala", "sc", "csv", "py",
];
```

- [ ] **Step 5: Run tests to verify they pass**

Same commands as Step 3. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/s3Rules.ts src/services/s3Rules.test.ts src-tauri/src/aws/s3_rules.rs
git commit -m "$(cat <<'EOF'
feat: allow editing .py objects in S3 browser

EOF
)"
```

---

### Task 2: Python syntax highlighting with `@codemirror/lang-python`

**Files:**
- Modify: `package.json` / `package-lock.json` (via npm install)
- Modify: `src/components/s3/S3ObjectEditor.tsx`

**Interfaces:**
- Consumes: `languageExtensionForKey(fileKey)` switch on extension
- Produces: `.py` → `python()` from `@codemirror/lang-python`

- [ ] **Step 1: Install dependency**

```bash
npm install @codemirror/lang-python
```

- [ ] **Step 2: Wire language mapping**

In `src/components/s3/S3ObjectEditor.tsx`:

```typescript
import { python } from "@codemirror/lang-python";
```

In `languageExtensionForKey`:

```typescript
case "py":
  return python();
```

Place near the existing `sql` case for consistency with other official lang packages.

- [ ] **Step 3: Verify TypeScript build for the editor file**

Run:

```bash
npm test -- src/services/s3Rules.test.ts
npx tsc --noEmit
```

Expected: tests pass; `tsc` has no errors related to `@codemirror/lang-python` / `S3ObjectEditor`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/s3/S3ObjectEditor.tsx
git commit -m "$(cat <<'EOF'
feat: highlight Python in S3 object editor

EOF
)"
```

---

## Spec Coverage Self-Check

| Spec requirement | Task |
|------------------|------|
| Allowlist `py` frontend + backend | Task 1 |
| `@codemirror/lang-python` highlighting | Task 2 |
| Tests for `.py` editability | Task 1 |
| No other suffixes / no limit change | Global Constraints |
