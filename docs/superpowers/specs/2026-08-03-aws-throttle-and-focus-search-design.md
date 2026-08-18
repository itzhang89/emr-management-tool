# AWS Throttle Guard + Focus Search Design

## Goals

1. Stop EMR API auto-refresh from stacking requests and hitting AWS `Too Many Requests`.
2. Let ⌘/Ctrl+F focus the Job History search box and the Logs job-id box, without breaking Logs “Find in log”.

## Rate limiting

### Behavior

- Job History / Submit Job refresh interval: **15s** (was 5s).
- Job History AWS sync: **no overlapping runs**. If a sync is in flight, skip the tick (or chain the next run after completion + interval).
- Submission-history `DescribeJobRun` fan-out: concurrency capped at **3**.
- On AWS throttle (`TooManyRequests`, `Throttling`, message containing “Too Many Requests”):
  - Mark error `retryable: true`.
  - Pause auto-refresh for that query for **60s** (toast once), then resume if still enabled.
- Prefer stopping refresh when there are no active jobs (Submit Job already does this).

### Non-goals

- Global AWS request queue across all services.
- Changing CloudWatch / Athena poll intervals in this change (only EMR job sync hot path).

## Focus search (⌘F)

### Job History

- On the history page, ⌘/Ctrl+F focuses the job search `RecentSearchInput` and selects existing text.
- Register as `history-focus-search` in the shortcuts help under a history (or navigation-adjacent) category.

### Logs (scheme 1 — context-aware)

- If the log viewer (`LogWorkspace`) is **not** mounted: ⌘/Ctrl+F focuses the job-id input.
- If the log viewer **is** mounted: existing Find-in-log behavior stays (toggle find bar).
- Update shortcut help copy: ⌘F focuses job id when no log is open; opens find when a log is open.

## Files

- `src/services/jobHistoryConstants.ts` — interval
- `src/hooks/useEmr.ts` — non-overlapping sync + throttle pause
- `src-tauri/src/commands/emr.rs` — Describe concurrency
- `src-tauri/src/error.rs` — retryable throttle codes
- `src/components/search/RecentSearchInput.tsx` — imperative focus API
- `src/pages/JobHistoryPage.tsx` / `LogsPage.tsx` — page-level ⌘F handlers
- `src/components/logs/LogWorkspace.tsx` — only handles ⌘F when viewer is active (unchanged intent)
- `src/data/keyboardShortcuts.ts` — docs entries + tests
