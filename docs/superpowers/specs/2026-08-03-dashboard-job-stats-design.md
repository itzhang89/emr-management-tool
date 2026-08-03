# Dashboard Job Stats (Daily + Hourly Drill-down)

## Goal

Replace the low-value Dashboard “Recent Jobs” / templates summary with cluster-scoped job statistics:

1. **KPI cards:** Running jobs, success rate over the selected range, failures in the last 24 hours.
2. **Parent chart:** Stacked bar of daily COMPLETED vs FAILED counts for a selectable window (**7 / 15 / 30** days, default **7**).
3. **Child chart:** Stacked bar of hourly COMPLETED vs FAILED for a selected day (default: today), opened by default and linked to the parent chart.

Data is scoped to the selected Virtual Cluster. Opening the Dashboard (or switching VC) syncs job runs from AWS into local `job_history` in the background. **Default sync window is 7 days**; choosing 15 or 30 in the report triggers a sync for that longer window.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Terminal states only | Chart + success-rate stats use `COMPLETED` (success) and `FAILED` only. Ignore PENDING / SUBMITTED / RUNNING / CANCELLED for those aggregates. |
| Scope | Selected Virtual Cluster via existing `VirtualClusterSelect` / session store (same as Job History). |
| Default sync | Background / default `ListJobRuns` uses `createdAfter = now - **7** days`, paginated, upsert, then prune. |
| Report range param | Dashboard control: **7 / 15 / 30** days, default **7**. Changing the value re-syncs with `createdAfter = now - N days` and redraws the parent chart for N days. |
| Retention | `JOB_HISTORY_RETENTION_DAYS`: 7 → **30** (covers the longest report window so longer syncs are not pruned away). |
| Sync strategy | Full window re-sync for the active range (not watermark-only incremental). Creation-time filters would miss late state changes inside the window. |
| Hourly child chart | Default expanded for **today**; click a parent day to change selection; ← / → / Today within the **selected range** window. |
| Timezone | Local workstation timezone for calendar days and hour buckets. |
| Failed (24h) KPI | Rolling last 24 hours by `createdAt` (not “calendar today”); independent of the 7/15/30 range. |
| Removed UI | Recent Jobs count card, Recent Jobs detail card, Templates count card. |

## UI structure

```
[ PageHeader: Dashboard ]     [ VirtualClusterSelect ]  [ Range: 7 | 15 | 30 ]

[ Running ]  [ Success Rate ({N}d) ]  [ Failed (24h) ]

┌─ Job Runs ({N} days) ────────────────────────────────┐
│  Stacked bars: Success | Failed                       │
│  Selected day highlighted; click bar → set selectedDate│
│  Optional corner: Syncing… while AWS sync in flight   │
└──────────────────────────────────────────────────────┘
┌─ {Local date} · Hourly          [←] [→] [Today] ─────┐
│  24 stacked bars (hours 0–23), Success | Failed       │
│  Empty day: zeros + “No completed/failed jobs this day”│
└──────────────────────────────────────────────────────┘
```

### Interaction

- On load with a VC: range = **7**, `selectedDate = today` (local); hourly chart visible immediately; sync last 7 days.
- Change range to 15 or 30: set Syncing; call sync with that `createdAfter`; parent chart shows N continuous local calendar days; clamp `selectedDate` into the new window (if it falls outside, snap to today).
- Change range back to 7: sync with 7-day window again; chart shows 7 days. Local rows older than 7 days may still exist until prune (retention 30); the **chart only plots the selected N days**.
- Click a day on the parent chart: update `selectedDate`, highlight that bar, recompute hourly series.
- Hourly ← / →: move one calendar day within `[today - (N-1), today]`; disable at edges.
- **Today:** jump to today.
- Switching Virtual Cluster: keep current range selection; reset `selectedDate` to today; trigger sync for the new VC with the current range.
- Sync failure: keep showing cached local data; surface a non-blocking sonner toast. Do not block the charts.

### KPI definitions

| Card | Definition |
|------|------------|
| Running | Count of jobs in the synced list with `state === "RUNNING"`. |
| Success Rate ({N}d) | Among jobs with `createdAt` in the selected N local calendar days and state COMPLETED or FAILED: `COMPLETED / (COMPLETED + FAILED)`. If denominator is 0, show `—`. Label reflects N (7 / 15 / 30). |
| Failed (24h) | Count of FAILED jobs with `createdAt >= now - 24h`. |

## Sync and data layer

### Retention

- Change `JOB_HISTORY_RETENTION_DAYS` in `src-tauri/src/db/repository.rs` from `7` to **`30`**.
- Existing `job_history_cutoff` / `prune_job_history` / list filters automatically follow.

### `list_job_runs` (virtual cluster, no keyword)

When `virtual_cluster_id` is present and there is no keyword search:

1. Accept an optional sync window (days), default **`7`** when omitted (Job History and any caller that does not pass a range keep today’s behavior of a 7-day pull, but with 30-day local retention).
2. Call EMR Containers `ListJobRuns` with `virtual_cluster_id` and `created_after = now - windowDays`.
3. Paginate with the same page-limit / token helpers used by `list_virtual_clusters` (`MAX_EMR_PAGINATION_PAGES`).
4. Upsert each page into `job_history`.
5. `prune_job_history` for the account (30-day cutoff).
6. Return `list_job_history` for that account + VC (30-day cutoff). The **UI** filters/aggregates to the selected N days for charts.

If pagination hits the page cap, log a WARN and return whatever was synced (do not pretend completeness).

**Unchanged paths:**

- No VC id → read local history only (account-wide), no AWS call.
- Keyword present → local filtered history only (existing search behavior).

### API / client wiring

- Extend the job-runs list request (Rust `JobRunRequest` + TS client) with optional `createdAfterDays` (or equivalent), allowed values conceptually `7 | 15 | 30`, default `7`.
- `useJobRuns(virtualClusterId, …, { createdAfterDays })` passes the Dashboard range into the sync.
- Job History continues to call without an explicit range → default **7**-day sync.

### Dashboard data flow

1. Resolve `effectiveVirtualClusterId`.
2. Hold `rangeDays` state: `7 | 15 | 30`, default `7`.
3. `useJobRuns(virtualClusterId, …, { createdAfterDays: rangeDays })` triggers sync for that window and returns local rows.
4. Derive KPIs and both chart series on the client for the selected N days (pure functions).
5. Hourly chart does **not** call AWS; it only buckets the already-synced rows for `selectedDate`.

## Aggregation rules

Pure helpers (e.g. `src/services/jobRunStats.ts`):

- Input: `JobRunSummary[]`, reference “now”, `rangeDays` (`7 | 15 | 30`), optional `selectedDate` (local calendar date).
- Filter terminal jobs: `state === "COMPLETED" | "FAILED"`.
- **Daily (N days):** for each local date in `[today - (N-1) … today]`, count success/failed by local calendar day of `createdAt`. Include days with zeros.
- **Hourly:** for `selectedDate`, count success/failed into hours `0..23` by local hour of `createdAt`. Include empty hours.
- Clamp `selectedDate` into the N-day window.

## Frontend modules

| Module | Responsibility |
|--------|----------------|
| `DashboardPage` | Layout, VC select, **range control (7/15/30)**, query wiring, KPI cards, sync affordance, `selectedDate` state. |
| `jobRunStats.ts` (+ tests) | Daily/hourly aggregation for N days, success rate, rolling 24h failures. |
| `JobRunsDailyChart` | Controlled N-day stacked bars; `selectedDate` + `onSelectDate`. |
| `JobRunsHourlyChart` | Date label, ←/→/Today (within N-day window), 24-hour stacked bars. |
| Chart primitives | Add shadcn `chart` (recharts). Match existing Card / muted styling; Success and Failed use distinct theme colors (e.g. chart-2 / destructive). |

## Out of scope

- Watermark-only incremental sync (unsafe for late state transitions).
- Auto-refresh polling on Dashboard (Job History toggle remains separate).
- Including CANCELLED or in-flight jobs in stacked charts / success rate.
- Per-cluster comparison charts, duration percentiles, cost/CloudWatch metrics.
- Timezone picker; server-side pre-aggregation API.
- Persisting the selected range across app restarts (YAGNI; default 7 on each visit is fine).
- Keeping Templates or Recent Jobs cards.
- Changing Job History’s default sync window away from 7 days.

## Testing

- **Unit:** `jobRunStats` — day/hour buckets for 7/15/30, local midnight boundaries, empty denominator, date clamp when range shrinks, rolling 24h vs calendar day.
- **Rust:** retention constant / cutoff spans 30 days; `list_job_runs` pagination with `created_after` for default 7 and explicit 15/30 (mocked client if practical).
- **UI:** default range 7 + hourly for today; switching to 15/30 updates chart width and triggers sync; parent click updates hourly; nav disabled at window edges; VC switch resets date to today but keeps range; Recent Jobs / Templates absent; syncing indicator when fetch in flight.

## Rollout notes

- After upgrade, local retention becomes 30 days; first opens still default-sync **7** days from AWS. Selecting 15/30 backfills that longer window for the VC.
- High-volume clusters may hit the pagination page cap within a long window; WARN + partial data is accepted for v1.
- Rows between day 8–30 remain in SQLite after a 15/30 sync until pruned past 30 days; charts always respect the UI-selected N only.
