# Log Noise Focus Filter

## Goal

Add a default-on **Focus** checkbox on the Job Logs page that hides known Spark/runtime noise from driver and executor stdout/stderr, so viewers can concentrate on business logs (`ETLLogger`, step/SQL blocks) and key container lifecycle information. Searching applies only to the focused view; downloads always use the full original log.

## Confirmed Decisions

| Topic | Decision |
|-------|----------|
| Filter strategy | **Noise blacklist** — drop known noisy Spark loggers/message patterns; unknown lines are kept |
| Default | Focus checkbox **checked** |
| Search scope | Search runs only on the **current view** (filtered when Focus is on) |
| Download | Always download the **full original** log (Focus does not affect download) |
| Search submit UX | Remove the **Search** button; submit on **Enter** in the search input |
| Regex toggle | Changing Regex does **not** auto-resubmit; user presses Enter again |
| Focus across files | Persist Focus checked state when switching log files (unlike search, which clears on `logText` change) |
| Multiline / continuation | No parent/child folding — non-Spark-format lines are kept independently |
| Persistence | No localStorage in this phase — default on each session/page load |
| Backend | Pure frontend filter only — no Tauri/Rust changes |

## Evidence (sample job)

Analyzed local srilanka profile job `000000037tm733505h0`:

| File | Lines | Approx. removable with Focus |
|------|------:|------------------------------:|
| driver stderr | 10,963 | ~89% |
| exec-1 stderr | 6,645 | ~88% |
| driver stdout | 465 | ~0% Spark INFO (mostly banner/env/plans — keep) |
| exec-1 stdout | 24 | GC lines — keep (small) |

Dominant noise: `TaskSetManager`, `DAGScheduler`, `BlockManagerInfo`, `TaskSchedulerImpl`, `MemoryStore`, executor `Running`/`Finished task`, `CoarseGrainedExecutorBackend Got assigned task`.

## UI

Place controls in `LogCommandBar` next to the existing Regex checkbox:

```
[Search input… (Enter)] [☑ Regex] [☑ Focus]  Hidden N lines  3/42 ◀ ▶
```

| Control | Behavior |
|---------|----------|
| Focus checkbox | Label `Focus`; `aria-label` e.g. `Hide noisy Spark log lines`; default checked |
| Hidden count | Show `Hidden N lines` only when Focus is on and `N > 0` |
| Search button | **Removed** |
| Search input | Placeholder `Search… (Enter)`; Enter calls existing submit handler |
| Prev/Next match | Unchanged; operate on matches within the current view text |

## Data pipeline

```
raw logText (from S3/CW)
        │
        ├──────────────────────────────► Download (always raw)
        │
        ▼
  Focus on? ──yes──► filterLogNoise(raw)
        │                 │
        no                ▼
        │            { text, hiddenCount }
        ▼                 │
   viewText ◄─────────────┘
        │
        ▼
  truncateLogTextForDisplay(viewText)   // existing MAX_LOG_VIEW_CHARACTERS
        │
        ▼
  display + buildSearchResult(submittedQuery)
```

`LogsPage` / download handlers continue to use the original content string. Only `LogWorkspace` derives the view text.

## Filter module

New pure module: `src/services/logNoiseFilter.ts`

```ts
export function filterLogNoise(text: string): {
  text: string;
  hiddenCount: number;
};
```

### Line classification

1. **Spark log line** — match  
   `^(\d{2}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERROR|DEBUG|TRACE) ([^:]+): (.*)$`  
   Logger base name = logger split on `$` (strip inner classes).
2. **Otherwise** — non-structured / continuation line.

### Hard rules

- **WARN / ERROR** — never hide.
- **Unknown loggers** — never hide (blacklist only).
- **Non-Spark-format lines** — keep, except `SLF4J:` lines (hide).
- **`Files s3://…` distribution lines** — keep (container setup).

### Blacklisted loggers (INFO only)

Drop when logger base equals or starts with:

`TaskSetManager`, `DAGScheduler`, `BlockManagerInfo`, `TaskSchedulerImpl`, `MemoryStore`, `AuditContextUtil`, `EMRFSToS3AConfigMapping`, `CodeGenerator`, `MapOutputTracker`, `AppInfoParser`, `Metrics`, `SecurityManager`, `ResourceUtils`, `ResourceProfile`, `JettyUtils`, `SparkEnv`, `DiskBlockManager`, `BlockManager`, `CoarseGrainedExecutorBackend`, `ShuffleBlockFetcherIterator`, `TorrentBroadcast`, `FileScanRDD`, `MapPartitionsRDD`, `TransportClientFactory`, `HiveConf`, `EMRParamSideChannel`, `SharedState`, `SubResultCacheManager`, `ContextCleaner`, `AsyncFileDownloader`, `SignalUtils`, `AbstractS3ACommitter`, `AbstractS3ACommitterFactory`, `PathOutputCommitterFactory`, `CommitOperations`, `SubscriptionState`, `NativeCodeLoader`, `ShutdownHookManager`, `CodecPool`, `SchedulerExtensionServices`, `YarnScheduler`

(Exact prefix matching should use a curated list in code with unit tests; extend only when new noise is confirmed.)

### Message-conditional rules (INFO)

| Logger | Hide when message matches | Keep examples |
|--------|---------------------------|---------------|
| `Executor` | starts with `Running task` or `Finished task`; or contains `block locks were not released` | `Starting executor ID`, OS/Java info, `Fetching` / `Adding` jars |
| `SparkContext` | not a lifecycle keep message | Keep: `Running Spark version`, `Submitted application`, stop/cleanup phrases |
| `Utils` | not service-start | Keep: `Successfully started service` |
| `SQLExecution` | contains `SparkListenerSQLExecutionObfuscatedInfo` | other SQLExecution lines if any |

`SparkContext` keep keywords (substring match): `Running Spark version`, `Submitted application`, `Successfully stopped`, `SparkContext cleaned`, `Invoking stop` (and similar stop lifecycle lines as implemented in tests).

### Intentionally kept (examples)

- `ETLLogger` and other app loggers
- Flyway / DB / Hikari
- `MicroBatchExecution`, `KafkaOffsetReaderAdmin`, `FileFormatWriter`, checkpoint/stream sink loggers
- K8s allocator / client utils used for executor pod lifecycle
- Driver/executor stdout unstructured content (banner, plans, GC)

## Component changes

| File | Change |
|------|--------|
| `src/services/logNoiseFilter.ts` | New filter + types |
| `src/services/logNoiseFilter.test.ts` | Unit tests from sample patterns |
| `src/components/logs/LogWorkspace.tsx` | `focusNoiseFilter` state (default `true`); derive `viewText`; wire Focus + hidden count; search/truncate on view |
| `src/components/logs/LogCommandBar.tsx` | Focus checkbox; remove Search button; update placeholder; optional hidden count |
| `src/pages/LogsPage.test.tsx` (and/or LogWorkspace tests) | Default Focus; Enter search; download still raw; search misses hidden noise |

When Focus toggles: recompute view text; if a search is already submitted, rematch against the new view and reset `activeMatchIndex` to 0.

Empty search + Enter: clear submitted search (preserve current submit semantics).

## Testing

1. **Unit — drop**: `TaskSetManager` / `DAGScheduler` / `Executor Running task` INFO lines removed.
2. **Unit — keep**: `ETLLogger`, any WARN/ERROR, `Files s3://`, SQL/`-- stepId=` blocks, `SparkContext Submitted application`.
3. **Unit — SLF4J**: `SLF4J:` lines removed.
4. **Unit — SQLExecution noise**: ObfuscatedInfo INFO lines removed.
5. **UI**: Focus default on; no Search button; Enter submits; `Hidden N lines` when applicable.
6. **UI**: With Focus on, search for a known noise substring finds 0 matches; with Focus off, finds matches.
7. **UI/download**: Download path still receives full original content.

## Out of scope

- Editable/custom noise rules UI
- Tauri-side filtering
- Persisting Focus in localStorage
- Separate GC filter for executor stdout
- Parent-line folding of stack traces / plans
- CloudWatch/S3 fetch changes

## Success criteria

- Opening driver stderr for a typical ETL job shows business and container signals first, without scrolling through thousands of task/broadcast lines.
- Users can uncheck Focus to see the raw log in the viewer.
- Download and archival remain complete and lossless.
- Search results always match what is visible in the viewer.
