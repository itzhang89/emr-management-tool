# S3 Browser: Edit Python (`.py`) Files

## Goal

Allow the S3 browser to open, edit, and save objects whose key ends in `.py`, with Python syntax highlighting in the object editor.

## Current Behavior

Editable extensions are a shared allowlist in:

- Frontend: `src/services/s3Rules.ts` (`EDITABLE_EXTENSIONS`)
- Backend: `src-tauri/src/aws/s3_rules.rs` (`EDITABLE_EXTENSIONS`)

Preview uses the same set. Files over 5 MB stay preview-only. `.py` is currently treated as read-only (“File type is read-only.”).

`S3ObjectEditor` maps extensions to CodeMirror languages. SQL already uses `@codemirror/lang-sql`; several other types use `@codemirror/legacy-modes`.

## Design

### 1. Allowlist

Add `py` to both frontend and backend `EDITABLE_EXTENSIONS`. No other extensions (`.pyi`, `.ipynb`, `.pyx`, etc.). Size limit and preview rules stay unchanged.

### 2. Syntax highlighting

Add dependency `@codemirror/lang-python` and map `.py` in `languageExtensionForKey` to `python()` from that package (same pattern as `sql()`).

Do not use `@codemirror/legacy-modes/mode/python` for this feature.

### 3. Tests

- Frontend `s3Rules.test.ts`: assert a small `.py` object is editable and previewable.
- Rust `s3_rules.rs` tests: same assertion for a `.py` key.

No new UI tests required unless the editor language mapping already has dedicated coverage that should be extended; the allowlist tests are the primary acceptance check.

## Out of Scope

- Changing the 5 MB editor limit
- Supporting non-`.py` Python-related suffixes
- Refactoring other languages off legacy modes
- Changing save/load/upload flows beyond editability gating

## Acceptance

1. Selecting an S3 object ending in `.py` (≤ 5 MB) opens an editable editor with Python highlighting.
2. Saving updates the object content like other editable text types.
3. `.py` objects larger than 5 MB remain preview-only with the existing size reason.
4. Frontend and backend allowlists stay in sync for `py`.
