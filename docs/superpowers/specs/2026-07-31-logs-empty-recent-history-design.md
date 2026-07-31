# Logs empty-state recent job history

Date: 2026-07-31

## Goal

When opening the Logs page with no selected job, keep the existing empty-state hint and show up to 10 cached recent job ids below it. Clicking a history item opens that job’s logs (same path as submitting the header search).

## Behavior

- Show only when `selectedJobId` is unset.
- Keep current dashed empty copy: select from Job History or enter a job id.
- If `readLogsJobIdSearchHistory()` is non-empty, render a “Recently viewed” section underneath with at most 10 job ids (existing `RECENT_SEARCH_HISTORY_LIMIT`).
- If history is empty, show only the empty copy (no empty “Recently viewed” chrome).
- Clicking an id calls the same submit path as the header: normalize + `setSelectedJobForLogs(jobId, effectiveVirtualClusterId)`.
- Storage remains `emr-eks:logs-job-id-search-recent` (job id strings only; virtual cluster is the page’s current effective cluster).
- Header `RecentSearchInput` dropdown behavior is unchanged.

## UI

- Extend `LogsEmptyState` with `recentJobIds` and `onSelectJobId`.
- Layout: empty hint, then optional titled list of mono job-id buttons (no card grid).
- Match existing muted / border styling; list should be scannable and keyboard-activatable via native buttons.

## Out of scope

- Persisting virtual cluster per history entry.
- Changing history write rules or limit.
- Routing changes.
