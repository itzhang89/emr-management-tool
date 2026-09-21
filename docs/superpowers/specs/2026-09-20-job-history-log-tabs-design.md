# Job History + Logs: one page, one tab per job

Status: implemented 2026-09-20.

## Why

Logs used to be a sidebar page of its own, driven by `sessionStore.selectedJobId`.
Comparing two jobs meant Job History → Logs → back to History → Logs again, and
every hop threw away the log tree selection, the source switch and the find bar.
Navigating anywhere else lost all of it.

So the log viewer moved into Job History: the job list is the first tab and never
closes, every job whose logs are opened gets a tab of its own, and a `+` opens an
empty one for a job the list does not show. Tabs that were not closed come back
after a restart, log text included; closing a tab is what releases its cache.

## Decisions

| Decision | Choice |
| --- | --- |
| Cache scope | Tab list *and* log text, per AWS account. Capacity-capped with eviction. |
| Tab limit | 10 tabs (drafts included). At the limit the page refuses and toasts; nothing is evicted behind the user's back. |
| By-id entry | Kept: `+` opens a draft tab (job id box + `LogsEmptyState`). Submitting an id promotes the draft in place. |
| Tab header | One compact line (job name, id, state, cluster) — no repeated page title. |
| Query cache seeding | Not done. The cached text is a *display* fallback while the normal queries run; seeding would have required account-scoping the log query keys first (a separate bug). |

## Shape

- `src/pages/JobHistoryPage.tsx` — the workspace: tab list, active tab, cap,
  persistence, and the cross-page open intent.
- `src/components/emr/JobHistoryTab.tsx` — the old page body (search, auto-refresh,
  cluster picker, `JobRunsPanel`), with Mod+F gated on being the active tab.
- `src/components/logs/LogsTab.tsx` — the old `LogsPage` body, now taking
  `jobId` / `virtualClusterId` / `active` and reporting snapshots upward. A tab
  with no `jobId` is a draft.
- `src/components/history/JobTabStrip.tsx` — Radix `TabsList` with each trigger
  *beside* its close button (a button inside a button is invalid and swallows
  Enter/Space), plus the `+`.
- `src/components/layout/PersistMount.tsx` — extracted from `DbHubPage`; panes
  mount on first activation and then stay mounted, so tab switches keep state.
- `src/services/logsTabStorage.ts` — `emr-eks:job-history-tabs:<accountId>`,
  versioned and validated on read, `fitLogTabs` for the budgets, metadata-only
  fallback when the origin is full.
- `src/hooks/useJobLogTabs.ts` — tab state, debounced writes with a synchronous
  flush on close, and the hydrate guard that stops one account's tabs being
  written under another's key.

## Budgets

Per tab 200k characters of log text, 1M across all tabs. Over budget, the least
recently viewed tabs lose their *text* first and keep everything else — identity,
label, selection, place in the strip — so a dropped payload is one reload, not a
lost tab. `localStorage` is shared with DBHub's workspace caches, which is why
this one stays bounded and degrades to metadata rather than throwing.

## Shortcuts

`⌘⇧[` / `⌘⇧]` cycle the tabs and wrap; `⌘N` opens an empty one; `⌘W` closes the
tab in front. All of them live in
the page (not `AppShell`, which owns the plain `⌘[` / `⌘]` page cycle and the
`⌘1…⌘9` page numbers) and are registered in the shortcut registry so the Help
dialog lists them. `⌘W` is claimed and `preventDefault`ed even on the fixed tab:
there is nothing there to close, but letting the key through would close the
window. A shortcut also bumps `focusRequestId`, which makes the strip focus the
tab it just switched to — Radix moves focus for its own arrow keys only, so
without it the ring (and the visible "active" box) stayed on the tab the user
had left while the pane behind it changed.

## Strip details

- `+` sits directly after the last tab, inside the same scrolling row, so it
  reads as "the next tab goes here" rather than a control pinned to the far edge
  of the window.
- Tab labels drop the submission stamp every run carries
  (`stripJobNameTimestamp`, `_<6 or 8 digit date>_<4 digit time>`) — with ten
  tabs open, all of them truncating to the same unreadable prefix is the whole
  problem. The full name stays as the tab's tooltip.

## Account scoping

Three things carry the account, and all three matter:

1. The storage key — `emr-eks:job-history-tabs:<accountId>` — plus a hydrate
   guard that refuses to persist while state still belongs to the previous
   account.
2. The log query keys in `src/hooks/useLogs.ts` (previously account-less, so
   switching accounts could serve one account's logs for another's job), and the
   four keys added to `invalidateAccountScopedQueries`.
3. The pane's React key, which includes the account: two accounts can hold a tab
   with the same `cluster:job` id, and React would otherwise keep the first
   account's mounted viewer, selection and text.

## Keywords worth knowing

- `active` on `LogWorkspace` — every mounted workspace listens on `window`, so an
  ungated handler would let ⌘F toggle the find bar in ten hidden tabs at once.
- Find state resets only when the log text actually changes by value; a background
  refetch used to wipe an open find bar.
- `LogTabIntent.nonce` — a one-shot token, so a tab the user closed is not
  reopened by a stale intent on the next render.
