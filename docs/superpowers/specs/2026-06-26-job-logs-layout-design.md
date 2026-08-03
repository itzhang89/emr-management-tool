# Job Logs Layout Redesign (Option C)

## Goal

Redesign the Job Logs page to prioritize log viewing and in-log search, while preserving all existing functionality. Replace the nested Card + fixed-height layout with a full-viewport dual-column workspace and a consolidated top command bar.

## Confirmed Decisions

| Topic | Decision |
|-------|----------|
| Command bar visibility | Hidden when no job is selected; show only PageHeader + empty state |
| Job context across sources | **One shared job ID** for S3 and CloudWatch; switching source only changes log tree/content, not job identity or describe/destination resolution |
| S3 / CloudWatch selection memory | Remember last selected **log file** independently per source tab (same job) |
| Job ID input | Fixed-width monospace field sized for EMR job IDs (~20 chars, e.g. `000000037o20vlk8ht2`) |
| Virtual cluster | Reuse `VirtualClusterSelect`; auto-select from navigation when cluster list matches; manual select only when no match |
| Resizable tree pane | **Phase 3 only** — not included in Phase 2 |

## Layout Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ PageHeader: Job Logs                                                         │
│   actions: [Job ID input] [View Logs] [VirtualClusterSelect]                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ COMMAND BAR (only when selectedJobId is set)                                 │
│ [S3|CW] │ driver › stderr │ 🔍 Search [Regex] [Go] │ 3/42 ◀ ▶ │ ↓ Copy ⓘ  │
├──────────────────┬───────────────────────────────────────────────────────────┤
│ LOG TREE         │ LOG CONTENT                                               │
│ flex-1 height    │ flex-1 height                                             │
└──────────────────┴───────────────────────────────────────────────────────────┘
```

Outer shell (match S3 Browser):

```tsx
<div className="flex max-h-[calc(100dvh-10rem)] min-h-0 flex-col gap-4">
  <PageHeader pageId="logs" actions={...} />
  {selectedJobId ? (
    <>
      <LogCommandBar ... />
      <LogWorkspace ... />
    </>
  ) : (
    <LogsEmptyState />
  )}
</div>
```

Remove the outer `Card` wrapper entirely.

## PageHeader — Job Context Row

### Job ID input

EMR on EKS job run IDs are fixed-length alphanumeric strings (~20 characters).

| Property | Value |
|----------|-------|
| Width | `w-[20ch]` (character-based, fits IDs like `000000037o20vlk8ht2`) |
| Font | `font-mono text-sm` |
| Shrink | `shrink-0` — never compress |
| Placeholder | `Enter job id` |
| Behavior | Pre-filled from `selectedJobId`; submit on View Logs or Enter |

### View Logs button

- Disabled when job ID is empty or no effective virtual cluster is available
- Calls `setSelectedJobForLogs(trimmedJobId, effectiveVirtualClusterId)`

### Virtual cluster — `VirtualClusterSelect`

Reuse `@/components/emr/VirtualClusterSelect` exactly as Job History does:

```tsx
<VirtualClusterSelect />
```

Default trigger width is `w-[220px]` (component default). Do **not** use a read-only text span.

Use `useEffectiveVirtualClusterId()` for:

- Enabling/disabling View Logs (when a resolvable cluster exists)
- Passing virtual cluster to `setSelectedJobForLogs` on manual submit
- Fallback in `useDescribeJobRun(selectedJobId, selectedJobVirtualClusterId ?? effectiveVirtualClusterId)`

### Virtual cluster — auto from navigation, manual only on no match

Priority when resolving which cluster the dropdown shows and which cluster queries use:

1. **`selectedJobVirtualClusterId`** — set by navigation (e.g. Job History → Logs via `setSelectedJobForLogs(job.id, job.virtualClusterId)`)
2. **`selectedVirtualClusterId`** — user's explicit choice in `VirtualClusterSelect` (manual lookup / correction)
3. **`useEffectiveVirtualClusterId()` fallback** — first RUNNING cluster, else first listed (existing component behavior)

**Auto-select on navigation:** When `selectedJobVirtualClusterId` is present and that ID exists in the loaded cluster list, sync it into `selectedVirtualClusterId` so the dropdown shows the job's cluster automatically.

```tsx
useEffect(() => {
  if (!selectedJobVirtualClusterId || !clusters.data?.clusters.length) return;
  const matched = clusters.data.clusters.some((c) => c.id === selectedJobVirtualClusterId);
  if (matched) {
    setSelectedVirtualClusterId(selectedJobVirtualClusterId);
  }
  // If no match: do not overwrite — user picks manually from VirtualClusterSelect
}, [selectedJobId, selectedJobVirtualClusterId, clusters.data?.clusters]);
```

| Scenario | Dropdown behavior |
|----------|-------------------|
| Open from Job History, VC in list | Auto-selected to job's VC |
| Open from Job History, VC not in list | No auto-select; user must choose |
| User types job ID + View Logs | Uses current `VirtualClusterSelect` value |
| User changes VC after navigation | `selectedVirtualClusterId` updates; re-submit View Logs to re-describe with new VC |

Do **not** auto-pick RUNNING/default cluster when a navigation VC was provided but unmatched — leave selection empty or show placeholder until the user chooses.

### PageHeader actions layout

```tsx
<div className="flex shrink-0 flex-wrap items-center gap-2">
  <form className="flex items-center gap-2" onSubmit={submitJobId}>
    <Input className="w-[20ch] shrink-0 font-mono text-sm" ... />
    <Button type="submit" disabled={!jobIdInput.trim() || !effectiveVirtualClusterId}>
      View Logs
    </Button>
  </form>
  <VirtualClusterSelect />
</div>
```

Loading/error for job describe and missing destinations render **below** PageHeader as inline alerts, not inside a Card.

## Command Bar — `LogCommandBar`

Visible only when `selectedJobId` is set. Sticky within the page scroll container.

### Sections (left → right, separated by vertical `Separator`)

#### 1. Source

Segmented `TabsList` (compact): **S3** | **CloudWatch**

- Same **shared job ID** and same `useDescribeJobRun` result for both sources
- Same enable/disable rules as today (`s3Destination` / `cloudWatchDestination`)
- Preserves `visitedSources` lazy mount pattern
- Default source: S3 if available, else CloudWatch (unchanged)
- Switching source does **not** reset job ID, VC, search input draft, or re-fetch job metadata — only swaps tree + log content hooks for that source

#### 2. Selection breadcrumb — `LogSelectionBreadcrumb`

Format: `{section} › {podShort} › {stream}`

Examples:

- `Driver › driver › stderr`
- `Executors › exec-1 › stdout`

No full path inline. Full S3 key or CloudWatch stream name in tooltip; Copy button duplicates path.

When nothing selected: muted `Select a log file`.

#### 3. Search (primary visual weight)

| Control | Notes |
|---------|-------|
| Input | `flex-1 min-w-[12rem]`, placeholder `Search in current log` |
| Regex | Compact checkbox or Switch |
| Search | Triggers existing `submitLogSearch` |
| Enter | In input, triggers search (new) |

Search state lives in `LogWorkspace` and is passed to both `LogCommandBar` and `LogContentPanel`.

Reset search when `logText` changes (existing behavior).

#### 4. Match navigation

- Label from `formatSearchMatchLabel`
- Previous / Next icon buttons with `aria-label`
- Disabled when no submitted search or zero matches

#### 5. Actions

| Action | Behavior |
|--------|----------|
| Download | Existing `onDownloadSelected` |
| Copy path | Clipboard full path + toast |
| Destination ⓘ | Popover replaces `LogDestinationSummary` |

### Responsive behavior

| Breakpoint | Layout |
|------------|--------|
| `≥ lg` | Single command bar row |
| `md – lg` | Row 1: Source + Breadcrumb + Actions; Row 2: Search + Matches (full width) |
| `< md` | Breadcrumb shows stream only; section/pod in tooltip |

## Log Workspace — `LogWorkspace`

`flex flex-1 min-h-0` dual column.

### Shared vs per-source state

| State | Scope |
|-------|-------|
| `selectedJobId`, destinations, `activeSource` | Shared (one job) |
| `s3SelectedKey`, `cloudWatchSelectedStream` | Per source tab |
| Search (`searchInput`, `submittedSearch`, …) | Per **current log file** — reset when log content changes (existing); optional: preserve per-source selection index when switching tabs if same search term (not required for v1) |

Per-source log file memory:

```tsx
const [s3SelectedKey, setS3SelectedKey] = useState<string>();
const [cloudWatchSelectedStream, setCloudWatchSelectedStream] = useState<string>();
```

Switching S3 ↔ CloudWatch on the **same job** restores the last log file selected for that source; auto-select first item only when that source has no prior selection for this job session.

Reset per-source selections when `selectedJobId` changes.

### Left — `LogFileTree`

| Property | Value |
|----------|-------|
| Default width | 280px |
| Height | `flex-1 min-h-0 overflow-y-auto` |
| Border | `border-r` |

Tree presentation (data from existing `buildEmrLogTree`):

```
CONTROLLER
  controller
    [stdout]  live
    [stderr]  live

EXECUTORS
  exec-0 (2)
    [stdout]  512 KB
    [stderr]  128 KB
```

- Pod group label: `formatLogPodLabel()` → `exec-0`, `driver`, etc.; full pod name in `title`
- Stream items: Badge for stdout/stderr
- Size / live indicator on the right
- Selected item: existing primary highlight

Empty: `No log streams found for this job.`

Fixed width in Phase 1–2. Resizable drag handle deferred to **Phase 3 only** (not Phase 2).

### Right — `LogContentPanel`

No search bar, no full path header. Structure:

1. Truncation banner (amber) — existing copy + Load full / Download
2. Full log loaded banner (emerald) — existing copy
3. Log body: `flex-1 min-h-0 overflow-y-auto bg-slate-950`
   - `<pre data-testid="log-content">` preserved
   - Highlight rendering unchanged
   - Scroll active match into view unchanged

Unselected log: placeholder text in pre area.

## Path Display — `logPathDisplay.ts`

New utilities in `src/services/logPathDisplay.ts`:

```ts
formatLogPodLabel(pod: string, type: JobLogType, indexInSection: number): string
formatLogBreadcrumb(item: JobLogStream | JobLogObject): { sections: string[]; fullPath: string }
getLogFullPath(item: JobLogStream | JobLogObject, destination: ...): string
```

Pod short name rules:

| Type | Rule |
|------|------|
| controller | `controller` |
| driver | `driver` if pod contains "driver", else last path segment |
| executor | `exec-{index}` within Executors section (sorted) |

## Component Structure

```
src/pages/LogsPage.tsx
src/components/logs/
  LogCommandBar.tsx
  LogWorkspace.tsx
  LogFileTree.tsx
  LogContentPanel.tsx
  LogSelectionBreadcrumb.tsx
  LogDestinationPopover.tsx
  LogsEmptyState.tsx
src/services/logPathDisplay.ts
```

### State ownership

| State | Owner |
|-------|-------|
| Job ID input, destinations, active source, visited sources | `LogsPage` |
| Per-source selected log id | `LogWorkspace` (or tab wrappers passing initial state) |
| Search + displayFullLog | `LogWorkspace` |
| Fetch hooks | S3/CloudWatch tab content → props into `LogWorkspace` |

## Page States

| State | UI |
|-------|-----|
| No job | PageHeader + dashed empty state; no command bar |
| Loading job config | Inline spinner under header |
| Job error | Destructive alert |
| No destinations | Dashed message; no command bar |
| Ready | Command bar + workspace |
| Loading streams | Tree area spinner; command bar search disabled |
| Loading content | Content area overlay |
| Tree empty | Message inside tree panel |

## Accessibility

- Command bar: `role="toolbar"` `aria-label="Log viewer controls"`
- Breadcrumb: `nav aria-label="Current log file"`
- Tree: `nav aria-label="Log files"`, selected `aria-current="true"`
- Search input: `aria-label="Search in current log"`
- Destination button: `aria-label="Log destination details"`

## Feature Preservation Checklist

- [ ] Job ID input + View Logs
- [ ] Virtual cluster via `VirtualClusterSelect` + `useEffectiveVirtualClusterId`
- [ ] Job History navigation with VC auto-select when cluster list matches
- [ ] S3 / CloudWatch tabs + lazy mount
- [ ] Controller / Driver / Executor tree grouping
- [ ] Auto-select first log (per source, only when no prior selection)
- [ ] Per-source selection memory on tab switch
- [ ] Log truncation preview + Load full log
- [ ] Search + Regex + highlight + Prev/Next + scroll into view
- [ ] Download (including CloudWatch pagination)
- [ ] Error / demo mode messages
- [ ] `data-testid="log-content"`

## New Additions

- Copy path button
- Enter to submit log search
- Destination details popover
- VC auto-select from navigation when cluster list contains job's VC

## Tests

| File | Coverage |
|------|----------|
| `LogsPage.test.tsx` | Layout selectors; command bar hidden without job; VC auto-select when matched / no overwrite when unmatched; per-source log memory on same job |
| `logPathDisplay.test.ts` | Pod labels, breadcrumb, full path |
| `AppShell.test.tsx` | Heading still "Job Logs" via PageHeader |

Preserve existing tests: truncation, full load, regex search, download, tab switching.

## Implementation Phases

### Phase 1 — Structure

1. PageHeader + job context row (fixed-width job ID + VirtualClusterSelect)
2. Full-height flex shell; remove outer Card
3. Split LogFileTree / LogContentPanel / LogWorkspace
4. Lift search state; wire LogCommandBar
5. Hide command bar when no job selected

### Phase 2 — Information density

1. `logPathDisplay.ts` + breadcrumb + destination popover
2. Tree pod short names + stream badges
3. Copy path; Enter to search
4. Per-source log file memory (same shared job ID)
5. VC auto-select from navigation (match-only)
6. Responsive command bar rows

**Explicitly not in Phase 2:** resizable tree pane.

### Phase 3 — Polish (optional)

1. **Resizable tree pane** (S3 Browser drag pattern) — only in this phase
2. `/` keyboard shortcut to focus search
3. Collapsible tree sections

## Out of Scope

- Cross-log search across multiple files
- Log syntax highlighting beyond search marks
- Auto-refresh of log content
