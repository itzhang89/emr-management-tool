# Job History Search History + Spark ID + Silent Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache last 10 Job History searches, normalize `spark-` job IDs before lookup, and silently check/install updates on startup (toast only on install success; check timeout 60s).

**Architecture:** Pure helpers for search history (`localStorage`) and job-id normalize; Job History page Popover for recent queries; extend `appUpdater` with silent check+install and wire once from `AppShell`.

**Tech Stack:** React, Vitest, Tauri updater plugin, existing Popover/Input UI.

**Spec:** `docs/superpowers/specs/2026-07-30-job-history-search-and-silent-update-design.md`

## Global Constraints

- Search history: max 10, dedupe by normalized key, store original typed string.
- Storage key: `emr-eks:job-history-search-recent`
- `spark-` strip is case-insensitive, frontend-only.
- Silent update: 60s timeout on `check()` only; download/install unlimited; toast only on install success.
- Manual Settings/About update UX unchanged.
- Failed download: silent; retry next launch via fresh check+download (no Range resume).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/services/emrJobId.ts` | `normalizeEmrJobRunId`, update `isLikelyEmrJobRunId` |
| `src/services/emrJobId.test.ts` | Normalize + likelihood tests |
| `src/services/jobHistorySearchHistory.ts` | Read/write/dedupe recent searches |
| `src/services/jobHistorySearchHistory.test.ts` | History unit tests |
| `src/pages/JobHistoryPage.tsx` | History Popover + normalize on submit |
| `src/pages/JobHistoryPage.test.tsx` | History + spark-id UI tests |
| `src/services/appUpdater.ts` | `checkAndInstallSilently` + check timeout |
| `src/services/appUpdater.test.ts` | Silent updater tests |
| `src/components/layout/AppShell.tsx` | Mount-time silent update once |

---

### Task 1: Normalize EMR / Spark job IDs

**Files:**
- Modify: `src/services/emrJobId.ts`
- Modify: `src/services/emrJobId.test.ts`

**Interfaces:**
- Produces:
  - `normalizeEmrJobRunId(value: string): string`
  - `isLikelyEmrJobRunId(value: string): boolean` — uses normalized value

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { isLikelyEmrJobRunId, normalizeEmrJobRunId } from "./emrJobId";

describe("normalizeEmrJobRunId", () => {
  it("strips a spark- prefix case-insensitively", () => {
    expect(normalizeEmrJobRunId("spark-000000037tga8qam664")).toBe("000000037tga8qam664");
    expect(normalizeEmrJobRunId("SPARK-000000037tga8qam664")).toBe("000000037tga8qam664");
  });

  it("trims whitespace and leaves non-spark ids unchanged", () => {
    expect(normalizeEmrJobRunId("  job-abc123  ")).toBe("job-abc123");
    expect(normalizeEmrJobRunId("failed")).toBe("failed");
  });
});

describe("isLikelyEmrJobRunId", () => {
  it("accepts EMR-style job ids", () => {
    expect(isLikelyEmrJobRunId("job-abc123")).toBe(true);
    expect(isLikelyEmrJobRunId("0123456789abcdef")).toBe(true);
  });

  it("accepts spark-prefixed application ids", () => {
    expect(isLikelyEmrJobRunId("spark-000000037tga8qam664")).toBe(true);
  });

  it("rejects generic search terms", () => {
    expect(isLikelyEmrJobRunId("failed")).toBe(false);
    expect(isLikelyEmrJobRunId("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/emrJobId.test.ts`

Expected: FAIL — `normalizeEmrJobRunId` not exported / spark-prefixed not accepted.

- [ ] **Step 3: Implement**

```ts
export function normalizeEmrJobRunId(value: string) {
  const trimmed = value.trim();
  return trimmed.replace(/^spark-/i, "").trim();
}

export function isLikelyEmrJobRunId(value: string) {
  const trimmed = normalizeEmrJobRunId(value);
  return /^job-[A-Za-z0-9-]+$/.test(trimmed) || /^[a-z0-9]{16,64}$/.test(trimmed);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/services/emrJobId.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/emrJobId.ts src/services/emrJobId.test.ts
git commit -m "Normalize spark- prefixed EMR job run ids before lookup."
```

---

### Task 2: Job History search history storage

**Files:**
- Create: `src/services/jobHistorySearchHistory.ts`
- Create: `src/services/jobHistorySearchHistory.test.ts`

**Interfaces:**
- Consumes: `normalizeEmrJobRunId` from `emrJobId.ts`
- Produces:
  - `JOB_HISTORY_SEARCH_HISTORY_LIMIT = 10`
  - `readJobHistorySearchHistory(): string[]`
  - `rememberJobHistorySearch(query: string): string[]`

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  JOB_HISTORY_SEARCH_HISTORY_LIMIT,
  readJobHistorySearchHistory,
  rememberJobHistorySearch
} from "./jobHistorySearchHistory";

describe("jobHistorySearchHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns empty history by default", () => {
    expect(readJobHistorySearchHistory()).toEqual([]);
  });

  it("remembers searches most-recent first, capped at 10, deduped by normalized id", () => {
    rememberJobHistorySearch("alpha");
    rememberJobHistorySearch("spark-000000037tga8qam664");
    rememberJobHistorySearch("000000037tga8qam664");
    rememberJobHistorySearch("beta");

    const history = readJobHistorySearchHistory();
    expect(history[0]).toBe("beta");
    expect(history[1]).toBe("000000037tga8qam664");
    expect(history).not.toContain("spark-000000037tga8qam664");
    expect(history).toContain("alpha");

    for (let i = 0; i < 12; i++) rememberJobHistorySearch(`q${i}`);
    expect(readJobHistorySearchHistory()).toHaveLength(JOB_HISTORY_SEARCH_HISTORY_LIMIT);
    expect(readJobHistorySearchHistory()[0]).toBe("q11");
  });

  it("ignores blank queries", () => {
    rememberJobHistorySearch("   ");
    expect(readJobHistorySearchHistory()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `npm test -- src/services/jobHistorySearchHistory.test.ts`

- [ ] **Step 3: Implement**

```ts
import { normalizeEmrJobRunId } from "./emrJobId";

const storageKey = "emr-eks:job-history-search-recent";
export const JOB_HISTORY_SEARCH_HISTORY_LIMIT = 10;

function historyKey(query: string) {
  return normalizeEmrJobRunId(query).toLowerCase();
}

export function readJobHistorySearchHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function rememberJobHistorySearch(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return readJobHistorySearchHistory();
  const key = historyKey(trimmed);
  const next = [
    trimmed,
    ...readJobHistorySearchHistory().filter((item) => historyKey(item) !== key)
  ].slice(0, JOB_HISTORY_SEARCH_HISTORY_LIMIT);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- src/services/jobHistorySearchHistory.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/jobHistorySearchHistory.ts src/services/jobHistorySearchHistory.test.ts
git commit -m "Persist last 10 Job History search queries with normalized dedupe."
```

---

### Task 3: Wire search history Popover + normalize on Job History page

**Files:**
- Modify: `src/pages/JobHistoryPage.tsx`
- Modify: `src/pages/JobHistoryPage.test.tsx`

**Interfaces:**
- Consumes: `normalizeEmrJobRunId`, `isLikelyEmrJobRunId`, `readJobHistorySearchHistory`, `rememberJobHistorySearch`
- On submit: remember **original** trimmed input; set `submittedSearch` to **normalized** value for keyword/AWS lookup.

- [ ] **Step 1: Add failing UI tests** to `JobHistoryPage.test.tsx`

```ts
it("shows recent searches on focus and applies one immediately", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem(
    "emr-eks:job-history-search-recent",
    JSON.stringify(["000000037tga8qam664", "failed"])
  );
  renderJobHistoryPage();
  const input = screen.getByPlaceholderText(/Search jobs/i);
  await user.click(input);
  expect(await screen.findByRole("button", { name: "000000037tga8qam664" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "000000037tga8qam664" }));
  expect(useJobRuns).toHaveBeenCalledWith("vc-1", expect.any(Boolean), "000000037tga8qam664");
});

it("strips spark- before searching and looking up in AWS", async () => {
  const user = userEvent.setup();
  jobs = [];
  useJobRuns.mockImplementation(() => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn()
  }));
  renderJobHistoryPage();
  const input = screen.getByPlaceholderText(/Search jobs/i);
  await user.type(input, "spark-000000037tga8qam664");
  await user.keyboard("{Enter}");
  expect(useJobRuns).toHaveBeenCalledWith("vc-1", expect.any(Boolean), "000000037tga8qam664");
  await user.keyboard("{Enter}");
  expect(describeJobRun).toHaveBeenCalledWith("000000037tga8qam664", "vc-1");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- src/pages/JobHistoryPage.test.tsx -t "recent searches|strips spark"`

- [ ] **Step 3: Implement page wiring**

Update `JobHistoryPage.tsx`:

- State: `historyOpen`, `recentSearches` (load via `readJobHistorySearchHistory` on mount / after remember).
- Wrap search `Input` in `Popover` (`open={historyOpen && recentSearches.length > 0}`).
- `onFocus` / click opens; list buttons call submit with that query.
- `submitLocalSearch`:
  - `original = searchInput.trim()`
  - if empty, clear submitted and return
  - `rememberJobHistorySearch(original)` then refresh `recentSearches`
  - `normalized = normalizeEmrJobRunId(original)`
  - existing find-in-aws signal logic uses `normalized` vs `submittedSearch`
  - `setSubmittedSearch(normalized)`
- Pass `searchedJobId={submittedSearch.trim()}` (already normalized).

Use Popover from `@/components/ui/popover`. Trigger can be the input wrapper; content is a vertical list of buttons (`variant="ghost"`, full width, truncate).

- [ ] **Step 4: Run JobHistoryPage tests — expect PASS**

Run: `npm test -- src/pages/JobHistoryPage.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/pages/JobHistoryPage.tsx src/pages/JobHistoryPage.test.tsx
git commit -m "Add Job History search history dropdown and spark- id normalization."
```

---

### Task 4: Silent startup updater

**Files:**
- Modify: `src/services/appUpdater.ts`
- Modify: `src/services/appUpdater.test.ts`
- Modify: `src/components/layout/AppShell.tsx`

**Interfaces:**
- Produces:
  - `UPDATE_CHECK_TIMEOUT_MS = 60_000`
  - `checkAndInstallSilently(options?: { onInstalled?: (version: string) => void }): Promise<"skipped" | "no-update" | "installed" | "failed">`
- In-process guard: module-level `silentUpdateInFlight` boolean so concurrent calls no-op as `"skipped"`.

- [ ] **Step 1: Write failing silent-updater tests**

```ts
it("silently skips when auto updater is unavailable", async () => {
  const check = vi.fn();
  const updater = createAppUpdater({ canUseAutoUpdater: false, check });
  await expect(updater.checkAndInstallSilently()).resolves.toBe("skipped");
  expect(check).not.toHaveBeenCalled();
});

it("times out only the check call after 60s and stays silent", async () => {
  vi.useFakeTimers();
  const check = vi.fn(() => new Promise(() => {}));
  const updater = createAppUpdater({ canUseAutoUpdater: true, check });
  const pending = updater.checkAndInstallSilently();
  await vi.advanceTimersByTimeAsync(60_000);
  await expect(pending).resolves.toBe("failed");
  vi.useRealTimers();
});

it("installs available updates and reports installed without toasting itself", async () => {
  const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
  const check = vi.fn().mockResolvedValue({
    version: "0.2.0",
    downloadAndInstall
  });
  const onInstalled = vi.fn();
  const updater = createAppUpdater({ canUseAutoUpdater: true, check });
  await expect(updater.checkAndInstallSilently({ onInstalled })).resolves.toBe("installed");
  expect(downloadAndInstall).toHaveBeenCalledOnce();
  expect(onInstalled).toHaveBeenCalledWith("0.2.0");
});

it("returns failed silently when install throws", async () => {
  const check = vi.fn().mockResolvedValue({
    version: "0.2.0",
    downloadAndInstall: vi.fn().mockRejectedValue(new Error("network"))
  });
  const updater = createAppUpdater({ canUseAutoUpdater: true, check });
  await expect(updater.checkAndInstallSilently()).resolves.toBe("failed");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- src/services/appUpdater.test.ts`

- [ ] **Step 3: Implement `checkAndInstallSilently` in `appUpdater.ts`**

```ts
export const UPDATE_CHECK_TIMEOUT_MS = 60_000;

let silentUpdateInFlight = false;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Update check timed out")), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// inside createAppUpdater return object:
async checkAndInstallSilently(options?: { onInstalled?: (version: string) => void }) {
  if (!canUseAutoUpdater) return "skipped" as const;
  if (silentUpdateInFlight) return "skipped" as const;
  silentUpdateInFlight = true;
  try {
    const update = await withTimeout(check(), UPDATE_CHECK_TIMEOUT_MS);
    if (!update) return "no-update" as const;
    await update.downloadAndInstall();
    options?.onInstalled?.(update.version);
    return "installed" as const;
  } catch {
    return "failed" as const;
  } finally {
    silentUpdateInFlight = false;
  }
}
```

Note: after failure, leave `silentUpdateInFlight = false` so a later mount in same SPA session could retry — but AppShell only mounts once. Spec says after failure in current session do not retry until next launch; AppShell single effect satisfies that. Optionally keep a `silentUpdateAttempted` flag set true after first attempt (success or fail) so remounts in HMR don't re-run — set `let silentUpdateAttempted = false` and skip if already attempted.

Prefer:

```ts
let silentUpdateAttempted = false;
// at start of checkAndInstallSilently:
if (silentUpdateAttempted || silentUpdateInFlight) return "skipped";
silentUpdateAttempted = true;
```

- [ ] **Step 4: Wire AppShell**

In `AppShell.tsx` `useEffect` (empty deps or alongside help menu effect):

```ts
void appUpdater.checkAndInstallSilently({
  onInstalled: () => {
    toast.success("Update installed. Restart the app to use the new version.");
  }
});
```

Import `appUpdater` from `@/services/appUpdater`.

- [ ] **Step 5: Run updater + AppShell related tests**

Run: `npm test -- src/services/appUpdater.test.ts src/components/layout/AppShell.test.tsx`

Expected: PASS (AppShell may need mock of `checkAndInstallSilently` if it currently only mocks `checkForUpdate` — add to existing mock).

- [ ] **Step 6: Commit**

```bash
git add src/services/appUpdater.ts src/services/appUpdater.test.ts src/components/layout/AppShell.tsx src/components/layout/AppShell.test.tsx
git commit -m "Silently check and install updates on startup with a 60s check timeout."
```

---

## Self-Review

1. Spec coverage: search history §1 → Tasks 2–3; spark- §2 → Tasks 1+3; silent update §3 → Task 4.
2. No placeholders.
3. Types: `checkAndInstallSilently` return union used consistently; history APIs return `string[]`.
