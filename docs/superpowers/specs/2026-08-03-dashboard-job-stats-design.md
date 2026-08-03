# Dashboard Job Stats (15-day + Hourly Drill-down)

## Goal

Replace the low-value Dashboard “Recent Jobs” / templates summary with cluster-scoped job statistics:

1. **KPI cards:** Running jobs, 15-day success rate, failures in the last 24 hours.
2. **Parent chart:** Stacked bar of daily COMPLETED vs FAILED counts for the past 15 calendar days.
3. **Child chart:** Stacked bar of hourly COMPLETED vs FAILED for a selected day (default: today), opened by default and linked to the parent chart.

Data is scoped to the selected Virtual Cluster. Opening the Dashboard (or switching VC) syncs the last 15 days of job runs from AWS into local `job_history` in the background (full 15-day window re-sync with upsert).

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Terminal states only | Chart + success-rate stats use `COMPLETED` (success) and `FAILED` only. Ignore PENDING / SUBMITTED / RUNNING / CANCELLED for those aggregates. |
| Scope | Selected Virtual Cluster via existing `VirtualClusterSelect` / session store (same as Job History). |
| Sync strategy | On open/switch VC: paginated `ListJobRuns` with `createdAfter = now - 15d`, upsert all pages, prune to 15 days. Not watermark-only incremental (creation-time filter would miss late state changes). |
| Retention | `JOB_HISTORY_RETENTION_DAYS`: 7 → **15**. |
| Hourly child chart | Default expanded for **today**; click a parent day to change selection; ← / → / Today within the 15-day window. |
| Timezone | Local workstation timezone for calendar days and hour buckets. |
| Failed (24h) KPI | Rolling last 24 hours by `createdAt` (not “calendar today”). |
| Removed UI | Recent Jobs count card, Recent Jobs detail card, Templates count card. |

## UI structure

```
[ PageHeader: Dashboard ]     [ VirtualClusterSelect ]

[ Running ]  [ 15d Success Rate ]  [ Failed (24h) ]

┌─ Job Runs (15 days) ─────────────────────────────────┐
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

- On load with a VC: `selectedDate = today` (local); hourly chart visible immediately.
- Click a day on the parent chart: update `selectedDate`, highlight that bar, recompute hourly series.
- Hourly ← / →: move one calendar day within `[today - 14, today]`; disable at edges.
- **Today:** jump to today.
- Switching Virtual Cluster: reset `selectedDate` to today; trigger sync for the new VC.
- Sync failure: keep showing cached local data; surface a non-blocking sonner toast. Do not block the charts.

### KPI definitions

| Card | Definition |
|------|------------|
| Running | Count of jobs in the synced list with `state === "RUNNING"`. |
| 15d Success Rate | Among jobs with `createdAt` in the last 15 local calendar days and state COMPLETED or FAILED: `COMPLETED / (COMPLETED + FAILED)`. If denominator is 0, show `—`. |
| Failed (24h) | Count of FAILED jobs with `createdAt >= now - 24h`. |

## Sync and data layer

### Retention

- Change `JOB_HISTORY_RETENTION_DAYS` in `src-tauri/src/db/repository.rs` from `7` to `15`.
- Existing `job_history_cutoff` / `prune_job_history` / list filters automatically follow.

### `list_job_runs` (virtual cluster, no keyword)

When `virtual_cluster_id` is present and there is no keyword search:

1. Call EMR Containers `ListJobRuns` with `virtual_cluster_id` and `created_after = now - 15 days`.
2. Paginate with the same page-limit / token helpers used by `list_virtual_clusters` (`MAX_EMR_PAGINATION_PAGES`).
3. Upsert each page into `job_history`.
4. `prune_job_history` for the account.
5. Return `list_job_history` for that account + VC (15-day cutoff).

If pagination hits the page cap, log a WARN and return whatever was synced (do not pretend completeness).

**Unchanged paths:**

- No VC id → read local history only (account-wide), no AWS call.
- Keyword present → local filtered history only (existing search behavior).

### Dashboard data flow

1. Resolve `effectiveVirtualClusterId` (same helper as Job History).
2. `useJobRuns(virtualClusterId)` triggers the enhanced sync and returns local rows.
3. Derive KPIs and both chart series on the client from that list (pure functions).
4. Hourly chart does **not** call AWS; it only buckets the already-synced rows.

Job History benefits from the same sync: listing a VC also loads ~15 days of runs.

## Aggregation rules

Pure helpers (e.g. `src/services/jobRunStats.ts`):

- Input: `JobRunSummary[]`, reference “now”, optional `selectedDate` (local calendar date).
- Filter terminal jobs: `state === "COMPLETED" | "FAILED"`.
- **Daily (15 days):** for each local date in `[today-14 … today]`, count success/failed by local calendar day of `createdAt`. Include days with zeros.
- **Hourly:** for `selectedDate`, count success/failed into hours `0..23` by local hour of `createdAt`. Include empty hours.
- Clamp `selectedDate` into the 15-day window.

## Frontend modules

| Module | Responsibility |
|--------|----------------|
| `DashboardPage` | Layout, VC select, query wiring, KPI cards, sync affordance, `selectedDate` state. |
| `jobRunStats.ts` (+ tests) | Daily/hourly aggregation, success rate, rolling 24h failures. |
| `JobRunsDailyChart` | Controlled 15-day stacked bars; `selectedDate` + `onSelectDate`. |
| `JobRunsHourlyChart` | Date label, ←/→/Today, 24-hour stacked bars. |
| Chart primitives | Add shadcn `chart` (recharts). Match existing Card / muted styling; Success and Failed use distinct theme colors (e.g. chart-2 / destructive). |

## Out of scope

- Watermark-only incremental sync (unsafe for late state transitions).
- Auto-refresh polling on Dashboard (Job History toggle remains separate).
- Including CANCELLED or in-flight jobs in stacked charts / success rate.
- Per-cluster comparison charts, duration percentiles, cost/CloudWatch metrics.
- Timezone picker; server-side pre-aggregation API.
- Keeping Templates or Recent Jobs cards.

## Testing

- **Unit:** `jobRunStats` — day/hour buckets, local midnight boundaries, empty denominator, date clamp, rolling 24h vs calendar day.
- **Rust:** retention constant / cutoff spans 15 days; list_job_runs pagination with `created_after` (mocked client if practical).
- **UI:** default hourly for today; parent click updates hourly; nav disabled at window edges; VC switch resets to today; Recent Jobs / Templates absent; syncing indicator when fetch in flight.

## Rollout notes

- Existing local rows older than 7 days may already have been pruned; first open after upgrade backfills from AWS for the selected VC.
- High-volume clusters may hit the pagination page cap within 15 days; WARN + partial data is accepted for v1.
