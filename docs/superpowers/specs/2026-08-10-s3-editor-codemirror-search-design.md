# S3 Browser: CodeMirror Standard Search

## Goal

Enable CodeMirror’s standard find/replace in the S3 object editor (`S3ObjectEditor`), matching the official basic editor setup, and document the shortcuts in the app keyboard-shortcuts help.

## Current Behavior

`S3ObjectEditor` uses CodeMirror 6 with line numbers, selection drawing, active line highlight, history, language highlighting, and custom bindings (`Mod-s` save, `ArrowLeft` focus list). It does **not** depend on `@codemirror/search`, so ⌘F / Ctrl+F does not open a search panel.

S3 shortcuts in `keyboardShortcuts.ts` cover list navigation and focus moves only. Logs has a separate custom find bar; that is out of scope.

## Decisions

- Use CodeMirror standard search (approach aligned with [basic editor example](https://codemirror.net/examples/basic/)): `highlightSelectionMatches()` + `searchKeymap`.
- Keep the default CodeMirror search panel UI/styling (no custom theme, no custom `createPanel`).
- Register Find (and related find navigation) in Shortcuts help under the S3 category.
- Do **not** bind ⌘R / Ctrl+R. CM6 opens find and replace in the same panel via `Mod-f`; replace UI is hidden automatically when the editor is read-only.

## Design

### 1. Dependency

Add `@codemirror/search` (same major line as existing `@codemirror/*` packages).

### 2. Editor extensions

In `S3ObjectEditor.tsx`:

- Import `highlightSelectionMatches` and `searchKeymap` from `@codemirror/search`.
- Add `highlightSelectionMatches()` to the extensions list.
- Include `...searchKeymap` in the existing `keymap.of([...])` alongside `defaultKeymap` and `historyKeymap`.

Optional but allowed: add `search()` with no config if needed for explicit search state; `openSearchPanel` enables search state when missing, so keymap + highlight is sufficient for the standard setup.

Do not customize panel DOM, phrases, or panel theme.

### 3. Standard keybindings (editor-scoped)

From CodeMirror `searchKeymap` (document these accurately in help text):

| Binding | Action |
| --- | --- |
| Mod-f | Open search panel |
| Mod-g / F3 | Find next |
| Shift-Mod-g / Shift-F3 | Find previous |
| Escape | Close search panel (when panel/editor search scope) |
| Mod-Alt-g | Goto line |
| Mod-d | Select next occurrence |
| Mod-Shift-l | Select all matches of selection |

Replace next / replace all are panel buttons (and Enter behavior inside the panel), not separate global shortcuts.

### 4. Shortcuts help

In `src/data/keyboardShortcuts.ts` (S3 category):

- Add entries for editor find (Mod-f) and find next/previous (Mod-g / Shift-Mod-g), describing that the panel includes replace when the file is editable.
- Do not add Shortcuts help entries for goto-line, select-next-occurrence, or select-all-matches (those remain editor-only via `searchKeymap`).
- Extend `keyboardShortcuts.test.ts` accordingly.

### 5. Interaction with existing S3 shortcuts

- List `Escape` (“Go up”) remains on the object list handler only. When the search panel is open/focused, CodeMirror closes the panel on Escape; no page-level Esc handler should intercept that.
- Existing `Mod-s` save and `ArrowLeft` focus-list bindings stay as-is (`Prec.highest` for save/list as today).
- Read-only objects: find works; replace controls are omitted by CodeMirror when `EditorState.readOnly` is true.

### 6. Tests

- Update shortcut registry tests for new S3 find shortcut ids / primary keys.
- Prefer a focused editor-level check if the project already has an easy pattern for CodeMirror keymaps; otherwise shortcut registry coverage is the required acceptance test. No new Logs or page-level E2E required.

## Out of Scope

- Custom search panel UI or app-themed panel chrome
- Changing Logs `LogFindBar`
- Binding Mod-r for replace
- Extending search to other editors (Glue SQL, etc.) unless already sharing `S3ObjectEditor`

## Acceptance

1. With focus in the S3 object editor, Mod-f opens the default CodeMirror search panel.
2. Find next/previous work via Mod-g / Shift-Mod-g (and F3 variants).
3. Editable files show replace controls; read-only previews do not.
4. Escape closes the search panel without requiring a page refresh; list Esc go-up still works when the list has focus.
5. Shortcuts help lists S3 find (and next/previous) under S3 Browser.
6. `@codemirror/search` is a declared dependency.
