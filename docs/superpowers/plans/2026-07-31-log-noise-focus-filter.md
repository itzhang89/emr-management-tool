# Log Noise Focus Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-on Focus checkbox that hides known Spark noise from the Logs viewer (blacklist), search only the current view via Enter (no Search button), and always download the full original log.

**Architecture:** Pure `filterLogNoise(text)` in `src/services/logNoiseFilter.ts`. `LogWorkspace` derives `viewText` when Focus is on, then truncates/searches that view. `LogCommandBar` exposes Focus + hidden count and drops the Search button. Download paths keep using raw `logText` from `LogsPage`.

**Tech Stack:** React, Vitest, Testing Library, existing Logs page components.

**Spec:** `docs/superpowers/specs/2026-07-31-log-noise-focus-filter-design.md`

## Global Constraints

- Filter strategy: noise **blacklist**; unknown loggers and non-Spark lines are kept (except `SLF4J:`).
- WARN / ERROR never hidden.
- Focus default **checked**; survives log-file switches; not persisted to localStorage.
- Search applies only to the current view; Download always uses full original content.
- Remove Search button; submit search on Enter only.
- No Tauri/Rust changes; no editable rules UI.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/services/logNoiseFilter.ts` | `filterLogNoise` + blacklist / message rules |
| `src/services/logNoiseFilter.test.ts` | Unit tests for keep/drop cases |
| `src/components/logs/LogCommandBar.tsx` | Focus checkbox, hidden count, remove Search button, placeholder |
| `src/components/logs/LogWorkspace.tsx` | Focus state, view pipeline, wire props |
| `src/pages/LogsPage.test.tsx` | Enter search, Focus default, noise search, download still raw |

---

### Task 1: `filterLogNoise` service (TDD)

**Files:**
- Create: `src/services/logNoiseFilter.ts`
- Create: `src/services/logNoiseFilter.test.ts`

**Interfaces:**
- Produces: `filterLogNoise(text: string): { text: string; hiddenCount: number }`

- [ ] **Step 1: Write failing tests**

Create `src/services/logNoiseFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterLogNoise } from "./logNoiseFilter";

const spark = (level: string, logger: string, message: string) =>
  `26/07/31 11:30:32 ${level} ${logger}: ${message}`;

describe("filterLogNoise", () => {
  it("drops blacklisted INFO loggers and counts hidden lines", () => {
    const input = [
      spark("INFO", "TaskSetManager", "Starting task 0.0 in stage 0.0 (TID 0)"),
      spark("INFO", "DAGScheduler", "Job 0 finished: count at Foo.scala:1, took 1.0 s"),
      spark("INFO", "ETLLogger", "Executing job dct__t_message_opened_snapshot")
    ].join("\n");

    const result = filterLogNoise(input);
    expect(result.hiddenCount).toBe(2);
    expect(result.text).toBe(spark("INFO", "ETLLogger", "Executing job dct__t_message_opened_snapshot"));
  });

  it("never drops WARN or ERROR even for blacklisted loggers", () => {
    const input = [
      spark("WARN", "TaskSetManager", "Lost task 0.0"),
      spark("ERROR", "DAGScheduler", "Job aborted"),
      spark("INFO", "TaskSetManager", "Finished task 0.0")
    ].join("\n");

    const result = filterLogNoise(input);
    expect(result.hiddenCount).toBe(1);
    expect(result.text).toContain("WARN TaskSetManager");
    expect(result.text).toContain("ERROR DAGScheduler");
    expect(result.text).not.toContain("Finished task");
  });

  it("applies Executor / SparkContext / Utils / SQLExecution message rules", () => {
    const input = [
      spark("INFO", "Executor", "Running task 1.0 in stage 2.0 (TID 3)"),
      spark("INFO", "Executor", "Finished task 1.0 in stage 2.0 (TID 3). 100 bytes result sent to driver"),
      spark("INFO", "Executor", "Starting executor ID 1 on host 100.64.24.188"),
      spark("INFO", "Executor", "1 block locks were not released by task 1.0"),
      spark("INFO", "SparkContext", "Created broadcast 1 from broadcast at DAGScheduler.scala:1"),
      spark("INFO", "SparkContext", "Submitted application: spark-000000037tm733505h0"),
      spark("INFO", "SparkContext", "Running Spark version 3.5.6-amzn-2"),
      spark("INFO", "Utils", "Successfully started service 'sparkDriver' on port 7078."),
      spark("INFO", "Utils", "Copying /tmp/foo to /home/hadoop/foo"),
      spark("INFO", "SQLExecution", "Generating and posting SparkListenerSQLExecutionObfuscatedInfo..."),
      spark("INFO", "SQLExecution", "Posted SparkListenerSQLExecutionObfuscatedInfo in 7 ms")
    ].join("\n");

    const result = filterLogNoise(input);
    expect(result.text).toContain("Starting executor ID 1");
    expect(result.text).toContain("Submitted application");
    expect(result.text).toContain("Running Spark version");
    expect(result.text).toContain("Successfully started service 'sparkDriver'");
    expect(result.text).not.toContain("Running task");
    expect(result.text).not.toContain("Finished task");
    expect(result.text).not.toContain("block locks were not released");
    expect(result.text).not.toContain("Created broadcast");
    expect(result.text).not.toContain("Copying /tmp/foo");
    expect(result.text).not.toContain("SparkListenerSQLExecutionObfuscatedInfo");
  });

  it("drops SLF4J lines but keeps Files s3://, SQL blocks, and unknown loggers", () => {
    const input = [
      "SLF4J: Failed to load class \"org.slf4j.impl.StaticLoggerBinder\".",
      "Files s3://bucket/jars/app.jar from /tmp/app.jar to /home/hadoop/app.jar",
      "-- stepId=1",
      "select 1;",
      spark("INFO", "MicroBatchExecution", "Streaming query made progress"),
      spark("INFO", "TotallyNewBusinessLogger", "keep me")
    ].join("\n");

    const result = filterLogNoise(input);
    expect(result.hiddenCount).toBe(1);
    expect(result.text).toContain("Files s3://");
    expect(result.text).toContain("-- stepId=1");
    expect(result.text).toContain("select 1;");
    expect(result.text).toContain("MicroBatchExecution");
    expect(result.text).toContain("TotallyNewBusinessLogger");
    expect(result.text).not.toContain("SLF4J:");
  });

  it("strips inner-class suffixes when matching logger names", () => {
    const input = spark(
      "INFO",
      "KubernetesClusterSchedulerBackend$KubernetesDriverEndpoint",
      "Registered executor NettyRpcEndpointRef"
    );
    // Not on blacklist as keep-worthy k8s noise? Spec blacklists only listed names;
    // KubernetesClusterSchedulerBackend is NOT blacklisted — keep.
    const kept = filterLogNoise(input);
    expect(kept.hiddenCount).toBe(0);

    const noise = filterLogNoise(
      spark("INFO", "BlockManagerInfo$Something", "Added broadcast_1_piece0 in memory")
    );
    expect(noise.hiddenCount).toBe(1);
  });

  it("returns empty text and zero hidden for empty input", () => {
    expect(filterLogNoise("")).toEqual({ text: "", hiddenCount: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/services/logNoiseFilter.test.ts`

Expected: FAIL — module not found / `filterLogNoise` undefined.

- [ ] **Step 3: Implement `filterLogNoise`**

Create `src/services/logNoiseFilter.ts`:

```ts
const SPARK_LINE_RE =
  /^(\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERROR|DEBUG|TRACE) ([^:]+): (.*)$/;

/** Exact logger base names (after stripping `$...`) that are always noise at INFO. */
const NOISE_LOGGER_EXACT = new Set([
  "TaskSetManager",
  "DAGScheduler",
  "BlockManagerInfo",
  "TaskSchedulerImpl",
  "MemoryStore",
  "AuditContextUtil",
  "EMRFSToS3AConfigMapping",
  "CodeGenerator",
  "AppInfoParser",
  "Metrics",
  "SecurityManager",
  "ResourceUtils",
  "JettyUtils",
  "SparkEnv",
  "DiskBlockManager",
  "CoarseGrainedExecutorBackend",
  "ShuffleBlockFetcherIterator",
  "TorrentBroadcast",
  "FileScanRDD",
  "MapPartitionsRDD",
  "TransportClientFactory",
  "HiveConf",
  "EMRParamSideChannel",
  "SharedState",
  "SubResultCacheManager",
  "ContextCleaner",
  "AsyncFileDownloader",
  "SignalUtils",
  "PathOutputCommitterFactory",
  "CommitOperations",
  "SubscriptionState",
  "NativeCodeLoader",
  "ShutdownHookManager",
  "CodecPool",
  "SchedulerExtensionServices"
]);

/** Prefix match — longer prefixes first is unnecessary with startsWith on curated list. */
const NOISE_LOGGER_PREFIXES = [
  "MapOutputTracker",
  "ResourceProfile",
  "BlockManager",
  "AbstractS3ACommitter",
  "YarnScheduler"
] as const;

const SPARK_CONTEXT_KEEP_SUBSTRINGS = [
  "Running Spark version",
  "Submitted application",
  "Successfully stopped",
  "SparkContext cleaned",
  "Invoking stop"
] as const;

function loggerBase(logger: string) {
  return logger.split("$")[0] ?? logger;
}

function isNoiseLogger(base: string) {
  if (NOISE_LOGGER_EXACT.has(base)) return true;
  return NOISE_LOGGER_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function shouldHideSparkLine(level: string, logger: string, message: string) {
  // Spec: blacklist and message rules apply to INFO only; WARN/ERROR/DEBUG/TRACE stay.
  if (level !== "INFO") return false;

  const base = loggerBase(logger);

  if (base === "Executor") {
    return (
      message.startsWith("Running task") ||
      message.startsWith("Finished task") ||
      message.includes("block locks were not released")
    );
  }

  if (base === "SparkContext") {
    return !SPARK_CONTEXT_KEEP_SUBSTRINGS.some((keep) => message.includes(keep));
  }

  if (base === "Utils") {
    return !message.includes("Successfully started service");
  }

  if (base === "SQLExecution") {
    return message.includes("SparkListenerSQLExecutionObfuscatedInfo");
  }

  return isNoiseLogger(base);
}

export function filterLogNoise(text: string): { text: string; hiddenCount: number } {
  if (!text) return { text: "", hiddenCount: 0 };

  const lines = text.split("\n");
  const kept: string[] = [];
  let hiddenCount = 0;

  for (const line of lines) {
    if (line.startsWith("SLF4J:")) {
      hiddenCount += 1;
      continue;
    }

    const match = SPARK_LINE_RE.exec(line);
    if (!match) {
      kept.push(line);
      continue;
    }

    const level = match[2]!;
    const logger = match[3]!;
    const message = match[4] ?? "";

    if (shouldHideSparkLine(level, logger, message)) {
      hiddenCount += 1;
      continue;
    }

    kept.push(line);
  }

  return { text: kept.join("\n"), hiddenCount };
}
```

Notes for implementer:
- Preserve trailing newline behavior of `split("\n").join("\n")` (no forced trailing `\n` unless present as empty last segment — same as input structure for typical logs).
- Do **not** blacklist `KubernetesClusterSchedulerBackend` / `ExecutorPodsAllocator` (container lifecycle — keep).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/services/logNoiseFilter.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/logNoiseFilter.ts src/services/logNoiseFilter.test.ts
git commit -m "$(cat <<'EOF'
Add Spark log noise filter for Focus view.

EOF
)"
```

---

### Task 2: LogCommandBar — Focus checkbox + Enter-only search

**Files:**
- Modify: `src/components/logs/LogCommandBar.tsx`

**Interfaces:**
- Consumes (new props):
  - `focusNoiseFilter: boolean`
  - `onFocusNoiseFilterChange: (checked: boolean) => void`
  - `hiddenNoiseCount?: number`
- Removes: Search button UI (keep `onSubmitSearch` for Enter)
- Placeholder: `Search… (Enter)`

- [ ] **Step 1: Update props and search UI**

In `LogCommandBar.tsx`:

1. Add props to the destructuring list and type block:

```ts
  focusNoiseFilter,
  onFocusNoiseFilterChange,
  hiddenNoiseCount = 0,
```

```ts
  focusNoiseFilter: boolean;
  onFocusNoiseFilterChange: (checked: boolean) => void;
  hiddenNoiseCount?: number;
```

2. Change the search `Input` placeholder and aria-label:

```tsx
placeholder="Search… (Enter)"
aria-label="Search in current log"
```

(Keep `aria-label` as `Search in current log` for a11y stability; only placeholder needs the Enter hint.)

3. After the Regex `<label>`, add Focus checkbox and hidden count; **delete** the Search `<Button>`:

```tsx
<label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
  <input
    type="checkbox"
    className="size-4"
    aria-label="Hide noisy Spark log lines"
    checked={focusNoiseFilter}
    disabled={searchDisabled}
    onChange={(event) => onFocusNoiseFilterChange(event.target.checked)}
  />
  Focus
</label>
{focusNoiseFilter && hiddenNoiseCount > 0 ? (
  <span className="shrink-0 text-xs text-muted-foreground">
    Hidden {hiddenNoiseCount.toLocaleString("en-US")} lines
  </span>
) : null}
```

4. Leave Enter `onKeyDown` calling `onSubmitSearch()` unchanged.

- [ ] **Step 2: Typecheck / fix call sites temporarily**

`LogWorkspace` will not compile until Task 3. Prefer completing Task 3 in the same working tree before expecting `tsc` green; do not commit Task 2 alone if the project fails typecheck — fold into Task 3 commit if needed. Preferred: finish Task 3 then commit both.

- [ ] **Step 3: Commit only if Task 3 props are wired; otherwise continue to Task 3 without committing**

---

### Task 3: Wire Focus pipeline in `LogWorkspace`

**Files:**
- Modify: `src/components/logs/LogWorkspace.tsx`
- Modify: `src/components/logs/LogCommandBar.tsx` (if not committed in Task 2)

**Interfaces:**
- Consumes: `filterLogNoise` from `@/services/logNoiseFilter`
- State: `focusNoiseFilter` default `true` — **do not** reset in the `[logText]` effect
- `viewText` / `hiddenNoiseCount` from filter when Focus on
- Truncate + search use `viewText`, not raw `logText`
- Pass Focus props into `LogCommandBar`
- `onDownload` unchanged (parent still holds raw content)

- [ ] **Step 1: Add Focus state and view derivation**

```ts
import { filterLogNoise } from "@/services/logNoiseFilter";

// inside component:
const [focusNoiseFilter, setFocusNoiseFilter] = useState(true);

const focused = useMemo(() => {
  if (!focusNoiseFilter) {
    return { text: logText, hiddenCount: 0 };
  }
  return filterLogNoise(logText);
}, [focusNoiseFilter, logText]);

const viewText = focused.text;
const hiddenNoiseCount = focused.hiddenCount;

const logDisplay = useMemo(() => {
  if (displayFullLog) {
    return {
      text: viewText,
      truncated: viewText.length > MAX_LOG_VIEW_CHARACTERS,
      totalCharacters: viewText.length,
      showingFullContent: true
    };
  }
  const truncated = truncateLogTextForDisplay(viewText);
  return { ...truncated, showingFullContent: false };
}, [displayFullLog, viewText]);
```

Important: truncation `totalCharacters` should reflect **view** length (filtered), matching what the user sees. Spec download still uses raw outside this component.

- [ ] **Step 2: Keep Focus across file switches**

In the existing `[logText]` effect, reset search/truncate flags but **do not** call `setFocusNoiseFilter`:

```ts
useEffect(() => {
  setDisplayFullLog(false);
  setSearchInput("");
  setSubmittedSearch("");
  setSubmittedRegexSearch(false);
  setRegexSearch(false);
  setActiveMatchIndex(0);
}, [logText]);
```

- [ ] **Step 3: Wire LogCommandBar props**

```tsx
<LogCommandBar
  ...
  focusNoiseFilter={focusNoiseFilter}
  onFocusNoiseFilterChange={setFocusNoiseFilter}
  hiddenNoiseCount={hiddenNoiseCount}
  ...
/>
```

When Focus toggles, existing effects that depend on `logDisplay.text` already reset `activeMatchIndex` to 0 — keep that dependency (it will fire when `viewText` changes).

- [ ] **Step 4: Run unit tests for filter + typecheck logs tests if any compile**

Run: `npm test -- src/services/logNoiseFilter.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/logs/LogCommandBar.tsx src/components/logs/LogWorkspace.tsx
git commit -m "$(cat <<'EOF'
Wire Focus noise filter into Logs viewer command bar.

EOF
)"
```

---

### Task 4: Update `LogsPage` tests

**Files:**
- Modify: `src/pages/LogsPage.test.tsx`

**Interfaces:**
- Consumes: existing `renderLogsPage` helpers; Focus checkbox `aria-label="Hide noisy Spark log lines"`
- Search via Enter; no `Search log` button

- [ ] **Step 1: Update the existing search test**

Replace the test currently named roughly `searches log content with a Search button...` (around line 594) with Enter-based submit and assert Search button absence:

```ts
it("searches log content on Enter and supports regex highlights with next and previous navigation", async () => {
  const user = userEvent.setup();

  renderLogsPage();

  await waitFor(() => expect(screen.getByTestId("log-content").textContent).toContain("hello s3"));

  const searchInput = screen.getByPlaceholderText(/Search… \(Enter\)/i);
  expect(screen.queryByRole("button", { name: /Search log/i })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Hide noisy Spark log lines/i })).toBeChecked();
  expect(screen.getByText("No results yet")).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: /Regex/i }));
  await user.type(searchInput, "needle\\s+(one|two)");
  expect(screen.queryAllByTestId("log-search-match")).toHaveLength(0);

  await user.keyboard("{Enter}");
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(screen.getAllByTestId("log-search-match")).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: /Next match/i }));
  expect(screen.getByText("2 / 2")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /Previous match/i }));
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
});
```

Also update any other test that uses placeholder `/Search in current log/i` to `/Search… \(Enter\)/i` (grep the file).

- [ ] **Step 2: Add Focus filter behavior test**

`formatSearchMatchLabel` returns `"0 / 0"` when there are no matches after submit. Download for S3 uses `downloadS3LogObject` then `saveTextFile` — follow the existing `"downloads the selected S3 log object"` test; stub `downloadS3LogObject` to return `rawLog` and assert `saveTextFile` is called with that full string (including the TaskSetManager line).

```ts
it("Focus hides Spark noise from the viewer and search, while download stays raw", async () => {
  const user = userEvent.setup();
  const rawLog = [
    "26/07/31 11:30:32 INFO TaskSetManager: Starting task UNIQUE_NOISE_TOKEN",
    "26/07/31 11:30:32 INFO ETLLogger: Executing job dct__demo"
  ].join("\n");

  useS3JobLogObject.mockReturnValue({
    data: { bucket: "logs-bucket", key: "stdout.gz", content: rawLog },
    isLoading: false,
    error: null
  });
  downloadS3LogObject.mockResolvedValue({
    bucket: "logs-bucket",
    key: "stdout.gz",
    content: rawLog
  });

  renderLogsPage();

  await waitFor(() => expect(screen.getByTestId("log-content").textContent).toContain("ETLLogger"));
  expect(screen.getByTestId("log-content").textContent).not.toContain("UNIQUE_NOISE_TOKEN");
  expect(screen.getByText("Hidden 1 lines")).toBeInTheDocument();

  const searchInput = screen.getByPlaceholderText(/Search… \(Enter\)/i);
  await user.type(searchInput, "UNIQUE_NOISE_TOKEN");
  await user.keyboard("{Enter}");
  expect(screen.getByText("0 / 0")).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: /Hide noisy Spark log lines/i }));
  expect(screen.getByTestId("log-content").textContent).toContain("UNIQUE_NOISE_TOKEN");

  await user.clear(searchInput);
  await user.type(searchInput, "UNIQUE_NOISE_TOKEN");
  await user.keyboard("{Enter}");
  expect(screen.getAllByTestId("log-search-match").length).toBeGreaterThan(0);

  await user.click(screen.getByRole("button", { name: /Download selected log/i }));
  await waitFor(() =>
    expect(saveTextFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("UNIQUE_NOISE_TOKEN")
    )
  );
});
```

Confirm `downloadS3LogObject` / `saveTextFile` mock names match the top of `LogsPage.test.tsx` (they already exist for the S3 download test).

- [ ] **Step 3: Run Logs page tests**

Run: `npm test -- src/pages/LogsPage.test.tsx`

Expected: PASS

- [ ] **Step 4: Run full unit suite**

Run: `npm test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/LogsPage.test.tsx
git commit -m "$(cat <<'EOF'
Cover Focus filter and Enter search on Logs page.

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Blacklist filter + WARN/ERROR keep + SLF4J drop | Task 1 |
| Message rules for Executor / SparkContext / Utils / SQLExecution | Task 1 |
| Unknown loggers + Files s3:// + SQL keep | Task 1 |
| Focus checkbox default on + Hidden N lines | Tasks 2–3 |
| Remove Search button; Enter submit | Tasks 2, 4 |
| View pipeline: filter → truncate → search | Task 3 |
| Focus persists across file switch | Task 3 |
| Download always raw | Task 4 (+ LogsPage unchanged) |
| Search only current view | Tasks 3–4 |

## Out of scope (do not implement)

- localStorage for Focus
- Tauri-side filtering
- Editable noise rules
- Parent/child multiline folding
- Dedicated GC filter for executor stdout
