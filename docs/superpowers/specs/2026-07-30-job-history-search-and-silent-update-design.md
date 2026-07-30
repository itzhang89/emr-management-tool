# Job History Search History, Spark ID Normalize, Silent Startup Update

## Goal

1. Cache the last 10 Job History search queries so users can reuse previous lookups (especially job IDs) without retyping.
2. Accept Spark-style IDs such as `spark-000000037tga8qam664`, strip the `spark-` prefix before lookup.
3. On every app startup, silently check for updates in the background; toast only when an update installs successfully. Network check times out at 1 minute. Failed downloads retry on the next launch with a fresh download.

## 1. Job History search history

### Behavior

- Persist only **submitted** non-empty queries (Enter or selecting a history item).
- Cap at **10** entries, most-recent first.
- Deduplicate by **normalized** query key (see §2). Duplicate moves to the front; display text keeps the latest original input.
- Storage key: `emr-eks:job-history-search-recent` (JSON string array), same style as existing job-history preferences.
- UI: on focus/click of the search input, if history is non-empty, show a Popover list of up to 10 items.
- Selecting an item: fill the input → run the existing submit-search path immediately → close the list.
- Escape or empty history: close / do not open the list.
- No “clear all history” control (YAGNI).

### Modules

- `services/jobHistorySearchHistory.ts` — read/write/dedupe helpers + unit tests.
- `JobHistoryPage` — wire Popover + history on submit/select.

## 2. `spark-` job ID normalization

### Rules

- Add `normalizeEmrJobRunId(value)` in `emrJobId.ts`:
  - trim
  - if the value starts with `spark-` (case-insensitive), remove that prefix and trim again
  - example: `spark-000000037tga8qam664` → `000000037tga8qam664`
- `isLikelyEmrJobRunId` runs on the normalized value so Spark-prefixed IDs still trigger Find-in-AWS.
- Job History submit path, local keyword filter, `searchedJobId`, and AWS `describeJobRun` all use the normalized id.
- Search history stores the **original** typed string; dedupe key uses the normalized form so `spark-xxx` and `xxx` collapse to one entry.
- No EMR backend API changes; normalization is frontend-only.

## 3. Silent startup auto-update

### Silent flow

- Add a silent path on `appUpdater` (e.g. `checkAndInstallSilently()`):
  1. If `canUseAutoUpdater` is false → return quietly.
  2. Run `check()` with a **60s** timeout only around the network check. Timeout / no-update / unavailable / check error → silent.
  3. If an update is available, call `downloadAndInstall()` with **no** 60s cap (large packages may take longer).
  4. Download/install failure → silent.
  5. Install success → toast: `Update installed. Restart the app to use the new version.` (same copy as Settings).

### Retry across launches

- Tauri updater does **not** support HTTP Range resume. A failed download is retried on the **next app start** by running the silent flow again (fresh check + full re-download). There is no durable partial-download state to clear; each attempt starts clean.
- Within one process: do not start a second silent download if one is already in progress; after a failure in the current session, do not retry until the next launch.

### Trigger and manual checks

- Trigger once from `AppShell` mount (`useEffect` with empty deps). Non-Tauri / development builds skip via `canUseAutoUpdater`.
- Settings / About **manual** “Check for Updates” behavior is unchanged (still toast on no-update, unavailable, and errors).
- No blocking dialog; no automatic relaunch.

## Out of scope

- Cross-device sync of search history.
- True HTTP Range resume for updater packages.
- Auto-relaunch after install.
- Clear-all search history UI.
- Changing manual update UX in Settings / About.

## Testing

- Unit: search-history read/write/dedupe/cap; `normalizeEmrJobRunId` / `isLikelyEmrJobRunId` with `spark-` prefix; silent updater timeout, success toast path, and silent failure paths (mocked).
- Component: Job History focus shows history; selecting an item submits search; Spark-prefixed id reaches normalized lookup.
