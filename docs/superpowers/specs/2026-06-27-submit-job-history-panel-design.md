# Submit Job Recent History Panel Design

## Goal

Show the 20 most recent job submissions on the Submit Job page without introducing a page-level scrollbar. Fully reuse Job History table and actions. Add keyboard shortcuts for Submit and Preview JSON.

## Layout

```
┌ PageHeader · Preview JSON (⌘⇧P) · Submit (⌘Enter) ────────────────────┐
│ Job Config Template          │ Runtime Selection                        │
│ (scroll if needed)           │ (320px)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Recent Submissions (≤20, full Job History table + actions, int. scroll)│
└─────────────────────────────────────────────────────────────────────────┘
```

- Page root: `h-[calc(100vh-3rem)] min-h-0 overflow-hidden` (same as Data Catalog).
- Form area: capped height (`max-h-[min(48vh,520px)]`), internal scroll when needed.
- History section: `flex-1 min-h-0`, table scrolls inside the panel only.

## Data

- Source: `list_submission_history` — local SQLite records where `sourceRequest` is set (jobs submitted through this app).
- Scope: current effective virtual cluster (matches Runtime Selection).
- Limit: 20 most recent app submissions per account (`SUBMISSION_HISTORY_LIMIT`).
- Auto-refresh: polls local list and refreshes active job states from AWS.
- Job History page continues to use `list_job_runs` (full cluster sync from AWS).

## Presentation

Shared modules:

- `services/jobHistoryConstants.ts` — refresh interval, page size, submission limit
- `services/jobHistoryPreferences.ts` — auto-refresh localStorage
- `services/emrJobId.ts` — job id heuristics for AWS lookup
- `hooks/useJobHistoryAutoRefresh.ts` — countdown + preference persistence
- `components/emr/JobAutoRefreshToggle.tsx` — shared toggle UI

Job History page owns a single `useJobRuns` query and passes `clusterJobsQuery` into `JobRunsPanel` to avoid duplicate fetches.

- Same columns: Job Name, State, Created Time, Duration, Actions
- Same actions: Detail, Logs, Kill, Rerun
- Submit page: max 20 rows, no pagination, auto-refresh toggle in panel header

## Keyboard shortcuts

| Action       | Keys              | Scope        |
|--------------|-------------------|--------------|
| Submit job   | Mod+Enter         | Submit page  |
| Preview JSON | Mod+Shift+P       | Submit page  |

Register in `keyboardShortcuts.ts` under a new **Submit Job** category. Show shortcut hints on header action buttons (Tooltip, same pattern as Data Catalog).

Shortcuts fire on the Submit Job page only; ignore when Preview JSON dialog is open.

## Out of scope

- Cross-cluster aggregated history.
- Search box on Submit page (use Job History page for full search).
