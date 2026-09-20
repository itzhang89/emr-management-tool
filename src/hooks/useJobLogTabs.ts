import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { rememberLogsJobIdSearch } from "@/services/logsJobIdSearchHistory";
import {
  MAX_LOG_TABS,
  readLogTabs,
  writeLogTabs,
  type CachedLogContent,
  type LogTabRecord,
  type LogTabsState
} from "@/services/logsTabStorage";

/** The one tab that is always there and never closes. */
export const HISTORY_TAB_ID = "history";

/**
 * One entry in the workspace's tab strip. Job tabs carry the record that gets
 * persisted; drafts and the fixed History tab are UI state only — an empty tab
 * the user never put a job in is not worth restoring.
 */
export interface WorkspaceTab {
  id: string;
  kind: "history" | "draft" | "job";
  jobId?: string;
  virtualClusterId?: string;
  jobName?: string;
  openedAt?: string;
  lastViewedAt?: string;
  activeSource?: "s3" | "cloudwatch";
  s3SelectedKey?: string;
  cloudWatchSelectedStream?: string;
  content?: CachedLogContent;
  contentTruncated?: boolean;
  contentDropped?: boolean;
}

/** Why a tab request was refused, so the page can say so. */
export type OpenTabResult = "opened" | "activated" | "at-capacity";

/** What a tab reports back for persistence. */
export interface TabSnapshot {
  jobName?: string;
  activeSource?: "s3" | "cloudwatch";
  s3SelectedKey?: string;
  cloudWatchSelectedStream?: string;
  content?: CachedLogContent;
}

/** Writes are coalesced: a tab selection change is worth persisting, but not
 *  worth a synchronous megabyte of JSON on every click. */
const PERSIST_DELAY_MS = 400;

function toRecord(tab: WorkspaceTab): LogTabRecord | undefined {
  if (tab.kind !== "job" || !tab.jobId || !tab.virtualClusterId) return undefined;
  return {
    id: tab.id,
    jobId: tab.jobId,
    virtualClusterId: tab.virtualClusterId,
    jobName: tab.jobName,
    openedAt: tab.openedAt ?? new Date().toISOString(),
    lastViewedAt: tab.lastViewedAt ?? new Date().toISOString(),
    activeSource: tab.activeSource,
    s3SelectedKey: tab.s3SelectedKey,
    cloudWatchSelectedStream: tab.cloudWatchSelectedStream,
    content: tab.content,
    contentLength: tab.content?.text.length ?? 0,
    contentTruncated: tab.contentTruncated,
    contentDropped: tab.contentDropped
  };
}

function fromRecord(record: LogTabRecord): WorkspaceTab {
  return {
    id: record.id,
    kind: "job",
    jobId: record.jobId,
    virtualClusterId: record.virtualClusterId,
    jobName: record.jobName,
    openedAt: record.openedAt,
    lastViewedAt: record.lastViewedAt,
    activeSource: record.activeSource,
    s3SelectedKey: record.s3SelectedKey,
    cloudWatchSelectedStream: record.cloudWatchSelectedStream,
    content: record.content,
    contentTruncated: record.contentTruncated,
    contentDropped: record.contentDropped
  };
}

/**
 * The Job History workspace's tabs: which ones are open, which one is on
 * screen, and enough of each one's state to be worth restoring later.
 *
 * State lives here rather than in a global store because the tabs are this
 * page's own working set — nothing outside needs to enumerate them, and the one
 * thing that does (another page asking to open a job's logs) arrives as an
 * intent prop instead. Persistence is per AWS account, so switching accounts
 * swaps the whole tab set rather than showing one account's jobs under another.
 */
export function useJobLogTabs() {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [{ id: HISTORY_TAB_ID, kind: "history" }]);
  const [activeTabId, setActiveTabId] = useState(HISTORY_TAB_ID);
  const draftCounter = useRef(0);
  // The account the tabs in state belong to. It is state, not a ref, so the
  // persist effect below can tell "these tabs are this account's" from "the
  // account just changed and these are still the previous one's" — the window
  // in which writing would file A's jobs under B's key.
  const [hydratedAccount, setHydratedAccount] = useState<string>();
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<{ tabs: WorkspaceTab[]; activeTabId: string; accountId?: string }>({
    tabs,
    activeTabId,
    accountId: undefined
  });
  latest.current = { tabs, activeTabId, accountId: hydratedAccount };

  /** Point the ref at a tab list that this render has not produced yet, so an
   *  immediate flush writes what the user just did rather than the state React
   *  is still catching up on. */
  const commit = useCallback(
    (nextTabs: WorkspaceTab[], nextActiveTabId: string) => {
      latest.current = { tabs: nextTabs, activeTabId: nextActiveTabId, accountId: hydratedAccount };
    },
    [hydratedAccount]
  );

  const persistNow = useCallback(() => {
    const { tabs: currentTabs, activeTabId: currentActive, accountId: currentAccount } = latest.current;
    if (!currentAccount) return;
    const records = currentTabs.map(toRecord).filter((record): record is LogTabRecord => Boolean(record));
    const active = records.some((record) => record.id === currentActive) ? currentActive : undefined;
    const state: LogTabsState = { version: 1, activeTabId: active, tabs: records };
    writeLogTabs(currentAccount, state);
  }, []);

  useEffect(() => {
    if (!accountId || hydratedAccount === accountId) return;
    const stored = readLogTabs(accountId);
    // Drafts are this session's, not this account's: they carry no job and no
    // payload, so a fresh account starts with just the fixed tab.
    setTabs([{ id: HISTORY_TAB_ID, kind: "history" }, ...stored.tabs.map(fromRecord)]);
    setActiveTabId(stored.activeTabId ?? HISTORY_TAB_ID);
    setHydratedAccount(accountId);
  }, [accountId, hydratedAccount]);

  useEffect(() => {
    // Guards the render between "account switched" and "that account's tabs are
    // loaded": scheduling there would persist the previous account's tabs.
    if (!hydratedAccount || hydratedAccount !== accountId) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(persistNow, PERSIST_DELAY_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [accountId, hydratedAccount, tabs, activeTabId, persistNow]);

  // Leaving the page mid-debounce (or quitting) must not lose the last change.
  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistNow();
    },
    [persistNow]
  );

  // Every tab except the fixed one counts against the limit, drafts included:
  // a draft is still a tab the user has to close, and the point of the cap is
  // to bound what the strip can hold, not just what it can persist.
  const jobTabCount = useMemo(() => tabs.filter((tab) => tab.kind !== "history").length, [tabs]);

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setTabs((current) =>
      current.map((tab) => (tab.id === tabId ? { ...tab, lastViewedAt: new Date().toISOString() } : tab))
    );
  }, []);

  const openJobTab = useCallback(
    (jobId: string, virtualClusterId: string, jobName?: string): OpenTabResult => {
      const id = `${virtualClusterId}:${jobId}`;
      const existing = tabs.find((tab) => tab.id === id);
      if (existing) {
        selectTab(id);
        return "activated";
      }
      if (tabs.filter((tab) => tab.kind !== "history").length >= MAX_LOG_TABS) {
        return "at-capacity";
      }
      const now = new Date().toISOString();
      // The caller usually has the job summary in hand, so the tab is labelled
      // from the first paint instead of flashing a raw id until describe lands.
      const tab: WorkspaceTab = { id, kind: "job", jobId, virtualClusterId, jobName, openedAt: now, lastViewedAt: now };
      setTabs((current) => current.concat(tab));
      setActiveTabId(id);
      // Only a job the user actually opened belongs in "recently viewed" —
      // restoring the cache at boot must not rewrite it.
      if (hydratedAccount) rememberLogsJobIdSearch(hydratedAccount, jobId);
      return "opened";
    },
    [hydratedAccount, selectTab, tabs]
  );

  const openDraftTab = useCallback((): OpenTabResult => {
    if (tabs.filter((tab) => tab.kind !== "history").length >= MAX_LOG_TABS) {
      return "at-capacity";
    }
    draftCounter.current += 1;
    const id = `draft:${draftCounter.current}`;
    setTabs((current) => current.concat({ id, kind: "draft" }));
    setActiveTabId(id);
    return "opened";
  }, [tabs]);

  /**
   * Hand a draft over to a real job. The tab is replaced rather than edited, so
   * the pane remounts with the job's props instead of carrying a draft's state
   * into a job it never fetched for.
   */
  const promoteDraftTab = useCallback(
    (draftId: string, jobId: string, virtualClusterId: string): OpenTabResult => {
      const id = `${virtualClusterId}:${jobId}`;
      const existing = tabs.find((tab) => tab.id === id && tab.id !== draftId);
      if (existing) {
        setTabs((current) => current.filter((tab) => tab.id !== draftId));
        selectTab(id);
        return "activated";
      }
      const now = new Date().toISOString();
      setTabs((current) =>
        current.map((tab) =>
          tab.id === draftId
            ? {
                id,
                kind: "job" as const,
                jobId,
                virtualClusterId,
                openedAt: now,
                lastViewedAt: now
              }
            : tab
        )
      );
      setActiveTabId(id);
      if (hydratedAccount) rememberLogsJobIdSearch(hydratedAccount, jobId);
      return "opened";
    },
    [hydratedAccount, selectTab, tabs]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      if (tabId === HISTORY_TAB_ID) return;
      const index = tabs.findIndex((tab) => tab.id === tabId);
      const remaining = tabs.filter((tab) => tab.id !== tabId);
      setTabs(remaining);
      if (activeTabId === tabId) {
        // Fall to the neighbour on the left, which is where the user's eye
        // already is, and only then to History.
        setActiveTabId(remaining[Math.max(index - 1, 0)]?.id ?? HISTORY_TAB_ID);
      }
      // Closing is the user releasing the cache, so it commits immediately —
      // a close that a crash could undo is not a release. The write reads the
      // tab list this update produces, not the one still in state.
      commit(
        remaining,
        activeTabId === tabId ? (remaining[Math.max(index - 1, 0)]?.id ?? HISTORY_TAB_ID) : activeTabId
      );
      persistNow();
    },
    [activeTabId, commit, persistNow, tabs]
  );

  const reportSnapshot = useCallback((tabId: string, snapshot: TabSnapshot) => {
    setTabs((current) => {
      let anyChanged = false;
      const next = current.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "job") return tab;
        const merged = { ...tab };
        let changed = false;
        if (snapshot.jobName !== undefined && snapshot.jobName !== tab.jobName) {
          merged.jobName = snapshot.jobName;
          changed = true;
        }
        if (snapshot.activeSource !== undefined && snapshot.activeSource !== tab.activeSource) {
          merged.activeSource = snapshot.activeSource;
          changed = true;
        }
        if (snapshot.s3SelectedKey !== undefined && snapshot.s3SelectedKey !== tab.s3SelectedKey) {
          merged.s3SelectedKey = snapshot.s3SelectedKey;
          changed = true;
        }
        if (
          snapshot.cloudWatchSelectedStream !== undefined &&
          snapshot.cloudWatchSelectedStream !== tab.cloudWatchSelectedStream
        ) {
          merged.cloudWatchSelectedStream = snapshot.cloudWatchSelectedStream;
          changed = true;
        }
        if (snapshot.content && snapshot.content.itemKey !== tab.content?.itemKey) {
          merged.content = snapshot.content;
          merged.contentTruncated = false;
          merged.contentDropped = false;
          changed = true;
        }
        if (!changed) return tab;
        anyChanged = true;
        return merged;
      });
      return anyChanged ? next : current;
    });
  }, []);

  return {
    tabs,
    activeTabId,
    /** The account these tabs belong to; undefined until the first hydrate. */
    accountId: hydratedAccount,
    jobTabCount,
    maxJobTabs: MAX_LOG_TABS,
    selectTab,
    openJobTab,
    openDraftTab,
    promoteDraftTab,
    closeTab,
    reportSnapshot
  };
}
