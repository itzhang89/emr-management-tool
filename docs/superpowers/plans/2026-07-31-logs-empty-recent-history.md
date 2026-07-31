# Logs Empty Recent History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Logs with no selected job, keep the empty hint and list up to 10 recent job ids; click opens logs.

**Architecture:** Extend `LogsEmptyState` to accept history + select handler; wire from `LogsPage` using existing `recentJobIdSearches` / `submitJobId`.

**Tech Stack:** React, Vitest, Testing Library, existing `logsJobIdSearchHistory`.

---

### Task 1: Empty state UI + LogsPage wiring

**Files:**
- Modify: `src/components/logs/LogsEmptyState.tsx`
- Modify: `src/pages/LogsPage.tsx`
- Modify: `src/pages/LogsPage.test.tsx`
- Create: `docs/superpowers/specs/2026-07-31-logs-empty-recent-history-design.md` (done)

- [x] **Step 1: Failing test** — when localStorage has recent ids and no selected job, assert “Recently viewed” and clicking an id sets `selectedJobId`.
- [x] **Step 2: Implement `LogsEmptyState`** with optional recent list.
- [x] **Step 3: Wire `LogsPage`** `<LogsEmptyState recentJobIds={...} onSelectJobId={submitJobId} />`.
- [x] **Step 4: Run** `npm test -- --run src/pages/LogsPage.test.tsx` and fix.
- [ ] **Step 5: Commit** when user asks (do not commit unless requested).
