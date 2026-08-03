# S3 Browser Path Picker Design

## Goal

Replace the S3 Browser header inline path editing with a read-only path display plus a folder browse button that reuses the Data Catalog `S3PathPickerDialog`. Move the Refresh button next to Create folder.

## Confirmed Decisions

| Topic | Decision |
|-------|----------|
| Path selection UX | Read-only path text; only the directory button opens the picker |
| Inline edit | Removed entirely (no click-to-edit input / datalist) |
| Picker reuse | Existing `S3PathPickerDialog` (Approach A) |
| Append submitUser | Not shown; do not pass related props |
| Refresh placement | Next to Create folder in the toolbar row |
| Directory button icon | `FolderOpen`, aria-label `Browse S3 path` |

## UI Layout

### Header (CardTitle)

- Show compact path via existing `displayedS3Path`, with `title={currentS3Path}` for the full path.
- Path is plain text (not a button / not editable).
- Adjacent icon button opens `S3PathPickerDialog`.

### Toolbar row

Order: **Up** → **Create folder** → **Refresh**.

Refresh behavior unchanged: `objects.refetch()` when a bucket is selected.

## Data Flow

1. Directory button sets `pathPickerOpen = true`.
2. Dialog receives `initialPath={currentS3Path}` and no append-submitUser props.
3. On `onSelect(path)`:
   - Parse with `parseS3PathInput`.
   - `setBucket` / `setPrefix` from the parsed result.
   - Clear selected object and editor content.
   - Close the dialog.
4. Existing `writeLastS3Path` effect continues to persist the current location.

Invalid selection is already guarded inside the dialog (“Select an S3 bucket first”).

## Cleanup

Remove from `S3BrowserPage`:

- State: `editingPath`, `pathInput`
- Handlers / effects that only serve inline editing (`openPath`, sync effect for `pathInput`)
- Header form / input / `datalist` (`s3-path-options`)
- Unused imports tied to that flow

Keep unchanged: folder drill-down, Up, account-switch path restore, job-monitoring injected prefix, compact path display, upload/download/create/delete/rename.

## Testing

Update `S3BrowserPage.test.tsx`:

- Replace inline path-edit coverage with: open browse dialog → select path → confirm → list uses new bucket/prefix.
- Compact path assertion: path is no longer a role=`button`; still shows compacted text.
- Refresh still works from the toolbar (icon-only label unchanged).

## Out of Scope

- Changes to `S3PathPicker` / `useS3PathPicker` APIs
- Data Catalog / Athena settings UI
- Append submitUser behavior
- Non-path browser features (upload, download, delete, etc.)
