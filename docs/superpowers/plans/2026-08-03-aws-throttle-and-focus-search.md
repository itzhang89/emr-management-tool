# AWS Throttle Guard + Focus Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce EMR API throttling from auto-refresh, and make ⌘F focus Job History / Logs search inputs (Logs: job id only when viewer closed).

**Architecture:** Frontend guards overlapping sync and lengthens the poll interval; Rust caps parallel DescribeJobRun; Errors mark throttle as retryable so the UI can pause. Search inputs gain an imperative `focus()` via ref; pages listen for Mod+F.

**Tech Stack:** React, TanStack Query, Tauri/Rust AWS SDK, Vitest.

---

### Task 1: Rate-limit constants + non-overlapping sync + throttle pause

**Files:**
- Modify: `src/services/jobHistoryConstants.ts`
- Modify: `src/hooks/useEmr.ts`
- Modify: `src/hooks/useJobHistoryAutoRefresh.ts` (countdown uses seconds constant)
- Test: `src/pages/JobHistoryPage.test.tsx` (interval expectation if any)
- Test: `src/services/jobRunState.test.ts` if needed

- [x] Change `JOB_HISTORY_REFRESH_INTERVAL_MS` to `15_000`
- [x] In `useJobRuns` sync effect: keep an `inFlight` flag / skip if sync running; only schedule next tick after settle when using interval
- [x] Detect throttle errors from `formatAppError` / error code/message; on throttle toast and disable auto-refresh path for 60s (local `throttlePausedUntil` state) without permanently clearing user preference
- [x] Run relevant vitest

### Task 2: DescribeJobRun concurrency + retryable throttle in Rust

**Files:**
- Modify: `src-tauri/src/commands/emr.rs` (`refresh_active_submission_jobs`)
- Modify: `src-tauri/src/error.rs`
- Test: unit test in `error.rs` for throttle code → retryable

- [x] Cap JoinSet with semaphore (3)
- [x] Set `retryable: true` for Throttling / TooManyRequests codes
- [x] `cargo test` for error module if applicable

### Task 3: RecentSearchInput focus API + Job History ⌘F

**Files:**
- Modify: `src/components/search/RecentSearchInput.tsx`
- Modify: `src/pages/JobHistoryPage.tsx`
- Modify: `src/data/keyboardShortcuts.ts`
- Test: `src/pages/JobHistoryPage.test.tsx`
- Test: `src/data/keyboardShortcuts.test.ts`

- [x] Expose `ref` with `focus()` / `select()`
- [x] Job History Mod+F focuses search when page mounted
- [x] Register shortcut entry for history focus search
- [x] Tests

### Task 4: Logs context-aware ⌘F

**Files:**
- Modify: `src/pages/LogsPage.tsx`
- Modify: `src/components/logs/LogWorkspace.tsx` (ensure find only when workspace mounted — already true)
- Modify: `src/data/keyboardShortcuts.ts` (update LOGS_FIND description)
- Test: `src/pages/LogsPage.test.tsx`

- [x] When `!showViewer`, Mod+F focuses job id input
- [x] When `showViewer`, LogWorkspace keeps find behavior; page handler must not steal the event (only attach when viewer closed, or check showViewer)
- [x] Update shortcut description
- [x] Tests for empty-state Mod+F focus

### Task 5: Verify

- [x] `npm test` / targeted vitest for touched files
- [x] `cargo test` for error + emr if easy
