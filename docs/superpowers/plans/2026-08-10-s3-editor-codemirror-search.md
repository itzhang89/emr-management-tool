# S3 Editor CodeMirror Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Wire CodeMirror’s standard search panel into `S3ObjectEditor` and document Find / Find next / Find previous in S3 shortcuts help.

**Architecture:** Add `@codemirror/search` and enable `highlightSelectionMatches()` plus `searchKeymap` in the existing CodeMirror extension list (same pattern as CodeMirror basicSetup). Register three S3 shortcut help entries; no custom search UI.

**Tech Stack:** React, CodeMirror 6 (`@codemirror/search`, `@codemirror/view`), Vitest, existing `keyboardShortcuts` registry.

## Global Constraints

- Use CodeMirror default search panel (no custom theme / `createPanel`).
- Do not bind Mod-r for replace; replace lives in the Mod-f panel.
- Shortcuts help: Find + Find next + Find previous only (not goto-line / select-next / select-all).
- Do not change Logs `LogFindBar`.
- Keep existing `Mod-s` and `ArrowLeft` editor bindings.

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json` / lockfile | Declare `@codemirror/search` |
| `src/components/s3/S3ObjectEditor.tsx` | Enable search extensions + keymap |
| `src/data/keyboardShortcuts.ts` | S3 Find / next / previous help entries |
| `src/data/keyboardShortcuts.test.ts` | Assert new shortcut ids and primary keys |

---

### Task 1: Shortcut registry entries for S3 find

**Files:**
- Modify: `src/data/keyboardShortcuts.ts`
- Modify: `src/data/keyboardShortcuts.test.ts`

**Interfaces:**
- Produces: `SHORTCUT_IDS.S3_FIND`, `SHORTCUT_IDS.S3_FIND_NEXT`, `SHORTCUT_IDS.S3_FIND_PREVIOUS`
- Produces: three `keyboardShortcuts` entries in category `"s3"`

- [x] **Step 1: Write the failing test**

Add to `src/data/keyboardShortcuts.test.ts`:

```typescript
  it("exposes S3 editor find shortcuts", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.S3_FIND)).toMatch(/F/i);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.S3_FIND_NEXT)).toMatch(/G/i);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.S3_FIND_PREVIOUS)).toMatch(/G/i);

    const find = keyboardShortcuts.find((s) => s.id === SHORTCUT_IDS.S3_FIND);
    expect(find?.category).toBe("s3");
    expect(find?.description.toLowerCase()).toMatch(/replace/);
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/data/keyboardShortcuts.test.ts`

Expected: FAIL (missing `S3_FIND` / related ids)

- [x] **Step 3: Write minimal implementation**

In `SHORTCUT_IDS` add:

```typescript
  S3_FIND: "s3-find",
  S3_FIND_NEXT: "s3-find-next",
  S3_FIND_PREVIOUS: "s3-find-previous",
```

After `S3_GO_UP` entry in `keyboardShortcuts`, insert:

```typescript
  {
    id: SHORTCUT_IDS.S3_FIND,
    category: "s3",
    label: "Find in editor",
    description:
      "Open the editor find panel when the file editor has focus (includes replace when the file is editable)",
    keys: [formatModShortcut("F")]
  },
  {
    id: SHORTCUT_IDS.S3_FIND_NEXT,
    category: "s3",
    label: "Find next",
    description: "Jump to the next match in the open S3 object editor",
    keys: [formatModShortcut("G"), "F3"]
  },
  {
    id: SHORTCUT_IDS.S3_FIND_PREVIOUS,
    category: "s3",
    label: "Find previous",
    description: "Jump to the previous match in the open S3 object editor",
    keys: [formatModShortcut("G", { shift: true }), "⇧F3"]
  },
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- src/data/keyboardShortcuts.test.ts`

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/data/keyboardShortcuts.ts src/data/keyboardShortcuts.test.ts
git commit -m "feat: document S3 editor find shortcuts in help"
```

---

### Task 2: Install `@codemirror/search` and wire S3ObjectEditor

**Files:**
- Modify: `package.json` (via npm install)
- Modify: lockfile (via npm install)
- Modify: `src/components/s3/S3ObjectEditor.tsx`

**Interfaces:**
- Consumes: `@codemirror/search` exports `highlightSelectionMatches`, `searchKeymap`
- Produces: editor extensions that open the default search panel on Mod-f

- [x] **Step 1: Install dependency**

Run: `npm install @codemirror/search@^6`

Expected: package listed under dependencies alongside other `@codemirror/*` packages

- [x] **Step 2: Wire editor extensions**

In `src/components/s3/S3ObjectEditor.tsx`:

1. Add import:

```typescript
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
```

2. Change keymap line from:

```typescript
keymap.of([...defaultKeymap, ...historyKeymap]),
```

to:

```typescript
keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap]),
```

3. Add `highlightSelectionMatches(),` to the `extensions` array (near other view helpers such as `highlightActiveLine()`).

Do not add a custom search panel theme or `search({ createPanel })`.

- [x] **Step 3: Typecheck / unit tests**

Run: `npm test -- src/data/keyboardShortcuts.test.ts`

Expected: PASS

If the project has a typecheck script, run it for the editor file path or full project as usual (e.g. `npx tsc --noEmit` if that is the repo convention).

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/s3/S3ObjectEditor.tsx
git commit -m "feat: enable CodeMirror standard search in S3 editor"
```

---

### Task 3: Manual acceptance check (agent notes + smoke)

**Files:** none required

- [x] **Step 1: Verify acceptance against spec**

Checklist (manual in app when possible; otherwise code-review confirm):

1. Mod-f opens `.cm-search` panel when editor focused
2. Mod-g / Shift-Mod-g navigate matches
3. Read-only editor omits replace controls; editable includes them
4. Escape closes panel; list Esc still goes up
5. Shortcuts help shows the three new S3 entries
6. `@codemirror/search` is in `package.json`

- [x] **Step 2: Commit plan checkboxes if updated**

If this plan file’s checkboxes were marked done during execution, commit the plan update; otherwise skip.

```bash
git add docs/superpowers/plans/2026-08-10-s3-editor-codemirror-search.md
git commit -m "docs: mark S3 CodeMirror search plan tasks done"
```

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Add `@codemirror/search` | Task 2 |
| `highlightSelectionMatches` + `searchKeymap` | Task 2 |
| Default panel, no custom UI | Task 2 constraint |
| Shortcuts help Find + next/previous | Task 1 |
| No Mod-r | Global constraint |
| Tests for shortcut registry | Task 1 |
| Acceptance checklist | Task 3 |
