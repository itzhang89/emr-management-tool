/**
 * Local persistence of the Job History workspace's log tabs.
 *
 * The page keeps one tab per job the user opened logs for, and every one of
 * them is worth surviving a restart: the whole point of the feature is to come
 * back to the logs you were reading without walking the job list again. So this
 * caches the tab list *and* the log text of the item each tab was last showing.
 *
 * That second part is what makes the budgets below load-bearing. Log text is
 * routinely hundreds of kilobytes, `localStorage` is a shared, few-megabyte
 * origin, and DBHub's own workspace cache already spends up to a megabyte per
 * connection there. Losing a draft because a log tab held on to a stale
 * driver-stdout would be a bad trade, so content is capped per tab, capped in
 * total, and dropped — never the tab itself — when the total runs over. A
 * dropped tab keeps its identity and its selection and simply reloads.
 *
 * Keys are scoped by AWS account first, like `dbWorkspaceCache`: switching
 * accounts swaps the whole key space instead of mixing two accounts' jobs.
 */

const PREFIX = "emr-eks:job-history-tabs";

/** Bumped when the shape below changes: an older payload is discarded, not
 *  guessed at. There is no migration path — the cache is a convenience. */
export const LOG_TABS_VERSION = 1;

/** Logs tabs have no automatic eviction on screen, so the count is bounded
 *  instead: the page refuses to open more and asks the user to close one. */
export const MAX_LOG_TABS = 10;

/** Per tab. Roughly two fifths of `MAX_LOG_VIEW_CHARACTERS`, so a tab that was
 *  readable on screen is still readable after a restart. */
export const LOG_TAB_CONTENT_BUDGET = 200_000;

/** Across every tab. Keeps this feature's footprint near DBHub's worst case
 *  rather than eating the origin whole. */
export const LOG_TAB_TOTAL_BUDGET = 1_000_000;

/** The log text a tab was last showing, plus which item it belonged to. */
export interface CachedLogContent {
  /** S3 key or CloudWatch stream name — whatever `selectedKey`/`selectedStream`
   *  would be, so the restored selection and the text stay in step. */
  itemKey: string;
  text: string;
  savedAt: string;
}

export interface LogTabRecord {
  /** `${virtualClusterId}:${jobId}` — a job run is only unique per cluster. */
  id: string;
  jobId: string;
  virtualClusterId: string;
  /** Last known job name, so a tab restored offline is not labelled with a raw id. */
  jobName?: string;
  openedAt: string;
  /** The eviction order when the total budget is exceeded. */
  lastViewedAt: string;
  activeSource?: "s3" | "cloudwatch";
  s3SelectedKey?: string;
  cloudWatchSelectedStream?: string;
  content?: CachedLogContent;
  /** Measured once per content change, so eviction never has to stringify to
   *  find out how big a payload is. */
  contentLength: number;
  /** The stored text is a prefix of the real log. */
  contentTruncated?: boolean;
  /** The text was dropped to stay within budget (or to save a full quota). */
  contentDropped?: boolean;
}

export interface LogTabsState {
  version: number;
  /** The tab to re-open on, when it is not the fixed Job History one. */
  activeTabId?: string;
  tabs: LogTabRecord[];
}

export function logsTabStorageKey(accountId: string) {
  return `${PREFIX}:${accountId}`;
}

export function emptyLogTabsState(): LogTabsState {
  return { version: LOG_TABS_VERSION, activeTabId: undefined, tabs: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseContent(value: unknown): CachedLogContent | undefined {
  if (!isRecord(value)) return undefined;
  const { itemKey, text, savedAt } = value;
  if (typeof itemKey !== "string" || typeof text !== "string") return undefined;
  return { itemKey, text, savedAt: typeof savedAt === "string" ? savedAt : new Date(0).toISOString() };
}

function parseTab(value: unknown): LogTabRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { id, jobId, virtualClusterId } = value;
  if (typeof id !== "string" || typeof jobId !== "string" || typeof virtualClusterId !== "string") {
    return undefined;
  }
  const content = parseContent(value.content);
  const activeSource = value.activeSource === "s3" || value.activeSource === "cloudwatch" ? value.activeSource : undefined;
  return {
    id,
    jobId,
    virtualClusterId,
    jobName: optionalString(value.jobName),
    openedAt: typeof value.openedAt === "string" ? value.openedAt : new Date(0).toISOString(),
    lastViewedAt: typeof value.lastViewedAt === "string" ? value.lastViewedAt : new Date(0).toISOString(),
    activeSource,
    s3SelectedKey: optionalString(value.s3SelectedKey),
    cloudWatchSelectedStream: optionalString(value.cloudWatchSelectedStream),
    content,
    contentLength: typeof value.contentLength === "number" ? value.contentLength : (content?.text.length ?? 0),
    contentTruncated: value.contentTruncated === true,
    contentDropped: value.contentDropped === true
  };
}

/**
 * A payload this module did not write is not a payload it should render: a
 * hand-edited or half-written entry must read as "no saved tabs" rather than
 * crash the page on boot. `readJson` cannot do this — it casts whatever parsed.
 */
export function parseStoredLogTabs(raw: unknown): LogTabsState {
  if (!isRecord(raw) || raw.version !== LOG_TABS_VERSION || !Array.isArray(raw.tabs)) {
    return emptyLogTabsState();
  }
  const tabs = raw.tabs.map(parseTab).filter((tab): tab is LogTabRecord => Boolean(tab));
  return { version: LOG_TABS_VERSION, activeTabId: optionalString(raw.activeTabId), tabs };
}

/**
 * Bring a state within budget before it is written.
 *
 * Truncation keeps the head of the log — the same slice the viewer already
 * shows (`truncateLogTextForDisplay`) — and marks it, so the panel can say the
 * rest is one reload away. When the *total* runs over, the least recently
 * viewed tabs lose their text first and keep everything else: the tab, its
 * label, its selection and its place in the strip all survive, which is what
 * makes a dropped payload a cheap loss rather than a lost tab.
 */
export function fitLogTabs(state: LogTabsState): LogTabsState {
  const fitted = state.tabs.map((tab) => {
    if (!tab.content) return tab;
    if (tab.content.text.length <= LOG_TAB_CONTENT_BUDGET) {
      return { ...tab, contentLength: tab.content.text.length, contentDropped: false };
    }
    const content = { ...tab.content, text: tab.content.text.slice(0, LOG_TAB_CONTENT_BUDGET) };
    return { ...tab, content, contentLength: content.text.length, contentTruncated: true };
  });

  // Oldest first, so both the tab cap and the content eviction give up the
  // least recently read tabs and keep the ones the user was just looking at.
  const byRecency = [...fitted].sort((a, b) => a.lastViewedAt.localeCompare(b.lastViewedAt));
  const kept = byRecency.slice(-MAX_LOG_TABS);
  let total = kept.reduce((sum, tab) => sum + (tab.content ? tab.contentLength : 0), 0);
  const trimmed = kept.map((tab) => {
    if (!tab.content || total <= LOG_TAB_TOTAL_BUDGET) return tab;
    total -= tab.contentLength;
    return { ...tab, content: undefined, contentLength: 0, contentDropped: true };
  });

  // Back to strip order — the array is the tab order on screen.
  const order = new Map(state.tabs.map((tab, index) => [tab.id, index]));
  trimmed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const activeTabId = trimmed.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : undefined;
  return { version: LOG_TABS_VERSION, activeTabId, tabs: trimmed };
}

function write(accountId: string, state: LogTabsState) {
  if (typeof window === "undefined") return;
  const key = logsTabStorageKey(accountId);
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
    return;
  } catch {
    // Quota reached. A metadata-only list is worth far more than nothing, and
    // this is the one failure the user would actually notice (tabs vanishing).
  }

  const withoutContent: LogTabsState = {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab, content: undefined, contentLength: 0, contentDropped: true }))
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(withoutContent));
    return;
  } catch {
    // Still too big: something else owns the origin. Leave the previous
    // payload alone rather than clearing a cache we cannot replace.
  }
}

export function readLogTabs(accountId: string): LogTabsState {
  if (typeof window === "undefined") return emptyLogTabsState();
  try {
    const raw = window.localStorage.getItem(logsTabStorageKey(accountId));
    if (!raw) return emptyLogTabsState();
    return parseStoredLogTabs(JSON.parse(raw));
  } catch {
    return emptyLogTabsState();
  }
}

export function writeLogTabs(accountId: string, state: LogTabsState) {
  if (typeof window === "undefined") return;
  if (state.tabs.length === 0) {
    clearLogTabs(accountId);
    return;
  }
  write(accountId, fitLogTabs(state));
}

export function clearLogTabs(accountId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(logsTabStorageKey(accountId));
  } catch {
    // ignore
  }
}
