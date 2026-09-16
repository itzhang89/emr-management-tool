import type { DbQueryResult } from "@/types/domain";

/**
 * Local persistence of connection query workspaces (DBHub design section 7,
 * layer 2). Keys are scoped by AWS account first — switching accounts swaps
 * the whole key space, so two accounts never overwrite each other's drafts —
 * then by connection id. Glue tab state stays with the existing
 * account-scoped Athena storages; this module is for JDBC connection tabs.
 *
 * Persisted: the SQL draft and the *metadata* of each result tab (title, SQL,
 * column names, row counts, timing). Result rows above the size budget are
 * dropped — the tab keeps its metadata and shows "results not cached · rerun";
 * small result sets are cached whole so a page switch restores them verbatim.
 */

const PREFIX = "emr-eks:dbhub-ws";

export const RESULT_CACHE_ROW_BUDGET = 200;

export interface CachedResultTab {
  id: string;
  title: string;
  sql: string;
  ranAt: string;
  durationMs?: number;
  /** Whole cached results when small enough; undefined when dropped. */
  result?: DbQueryResult;
  /** Set when the last run did not simply succeed, so a reload still says so. */
  runState?: "cancelled" | "failed";
  runError?: string;
}

export interface DbWorkspaceState {
  sql: string;
  activeResultTabId?: string;
  resultTabs: CachedResultTab[];
  /** Last selected database in the catalog tree. */
  selectedDatabase?: string;
  /**
   * Last selected schema. Empty string is meaningful: it is the tree's way of
   * saying "this engine has no schema level", which is where MySQL lands.
   */
  selectedSchema?: string;
  /** Whether the catalog pane is out of the way. */
  catalogCollapsed?: boolean;
}

function storageKey(accountId: string, connectionId: string) {
  return `${PREFIX}:${accountId}:${connectionId}`;
}

function readJson<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage quota or restricted context — cache is best-effort by design.
  }
}

/**
 * Drop oversized result bodies before persisting. A whole-result cache keeps
 * everything when it fits the row budget and a rough byte budget; otherwise
 * the rows are dropped but the tab's identity (title/sql/timing) survives so
 * the user can rerun with one click.
 */
function fitResultTabs(state: DbWorkspaceState): DbWorkspaceState {
  const resultTabs = state.resultTabs.map((tab) => {
    if (!tab.result) return tab;
    const withinRowBudget = tab.result.rows.length <= RESULT_CACHE_ROW_BUDGET;
    const serialized = withinRowBudget ? JSON.stringify(tab.result) : "";
    if (withinRowBudget && serialized.length <= 1_000_000) return tab;
    return { ...tab, result: undefined };
  });
  return { ...state, resultTabs };
}

export function readDbWorkspace(accountId: string, connectionId: string): DbWorkspaceState {
  return readJson<DbWorkspaceState>(storageKey(accountId, connectionId)) ?? { sql: "", resultTabs: [] };
}

export function writeDbWorkspace(accountId: string, connectionId: string, state: DbWorkspaceState) {
  writeJson(storageKey(accountId, connectionId), fitResultTabs(state));
}

export function clearDbWorkspace(accountId: string, connectionId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(accountId, connectionId));
  } catch {
    // ignore
  }
}
