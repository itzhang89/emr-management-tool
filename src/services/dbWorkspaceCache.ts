import type { DbQueryResult, SchemaObjectKind } from "@/types/domain";

/**
 * Local persistence of connection query workspaces (DBHub design section 7,
 * layer 2). Keys are scoped by AWS account first — switching accounts swaps
 * the whole key space, so two accounts never overwrite each other's drafts —
 * then by connection id. Glue tab state stays with the existing
 * account-scoped Athena storages; this module is for JDBC connection tabs.
 *
 * The shape is two levels deep, following the workspace the user sees: a
 * workspace holds **query tabs** (one SQL editor each), and a query tab holds
 * its own **result tabs**, so closing an editor takes its results with it.
 *
 * Persisted: every editor's SQL draft, and the *metadata* of each result tab
 * (title, SQL, column names, row counts, timing, how the grid was arranged).
 * Result rows above the size budget are dropped — the tab keeps its metadata
 * and shows "results not cached · rerun"; small result sets are cached whole
 * so a page switch restores them verbatim.
 */

const PREFIX = "emr-eks:dbhub-ws";

export const RESULT_CACHE_ROW_BUDGET = 200;

/** Rows per page unless the user says otherwise — DBeaver's own default. */
export const DEFAULT_FETCH_SIZE = 200;

/**
 * The ceiling on a page. Mirrors `MAX_PAGE_ROWS` in the Rust driver, which
 * clamps whatever is asked for; keeping the two in step means the UI never
 * offers a number the backend would quietly round down.
 */
export const MAX_FETCH_SIZE = 500;

/** How many editors, and how many results under one, a workspace keeps. */
export const MAX_QUERY_TABS = 8;
export const MAX_RESULT_TABS = 10;

/**
 * The two formats a result can be read in.
 *
 * It used to be three, with `"record"` among them — a field-per-row form. But
 * "one record at a time" was never a third format: it is one row of the page
 * read the other way round, alongside the page rather than instead of it. So the
 * format is a pair, and the record is `singleRecord`, which opens a panel under
 * whichever of the two is showing.
 */
export type ResultView = "grid" | "text";

/** One column's place in the sort order; the array's order is the priority. */
export interface ColumnSort {
  column: string;
  desc: boolean;
}

/**
 * How a cell's value is compared. The five a right-click offers, in the order
 * the menu shows them: equal, not equal, greater, less, and a contains.
 */
export type FilterOperator = "eq" | "ne" | "gt" | "lt" | "like";

/**
 * One condition on a column, made by right-clicking a cell.
 *
 * The value is kept as the *text the grid showed*, because that is what the
 * menu offered (`time_zone = 'UTC'`) and what a reader comparing a chip against
 * the cell needs to see. `isNull` rides alongside it for the reason
 * `formatCell` keeps a kind: NULL and the four letters that spell it are two
 * different values that render the same way, and a filter has to mean one of
 * them.
 */
export interface CellFilter {
  column: string;
  operator: FilterOperator;
  value: string;
  isNull: boolean;
}

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

  // --- How the grid is arranged. All optional: absent means the defaults
  // --- (grid view, no sort, no filters), so an old cache stays readable.

  view?: ResultView;
  /** Open the record panel under the rows, showing `recordIndex` transposed. */
  singleRecord?: boolean;
  sort?: ColumnSort[];
  /** Conditions every drawn row has to satisfy, in the order they were added. */
  filters?: CellFilter[];
  /** Which row the record panel is on, and the one the grid highlights. */
  recordIndex?: number;

  // --- Counting is explicit: a count re-runs the whole statement, so the
  // --- number is only ever there because somebody asked for it.

  /** Total rows the statement would return. Absent until asked. */
  totalCount?: number;
  /** Why there is no number, when the last count did not produce one. */
  countError?: string;
}

/** One SQL editor tab, and the results it has produced. */
export interface CachedQueryTab {
  id: string;
  title: string;
  sql: string;
  resultTabs: CachedResultTab[];
  activeResultTabId?: string;
  /** Rows per page for this editor's runs. */
  fetchSize: number;
  /**
   * The number the next unnamed result gets. Monotonic rather than derived
   * from `resultTabs.length`, so closing "Result 2" does not make the next run
   * claim its name again.
   */
  nextResultIndex: number;
}

export interface DbWorkspaceState {
  queryTabs: CachedQueryTab[];
  activeQueryTabId?: string;
  /** Last selected database in the catalog tree. */
  selectedDatabase?: string;
  /**
   * Last selected schema. Empty string is meaningful: it is the tree's way of
   * saying "this engine has no schema level", which is where MySQL lands.
   */
  selectedSchema?: string;
  /** Whether the catalog pane is out of the way. */
  catalogCollapsed?: boolean;
  /** Which object kinds the tree shows. Absent means tables only. */
  objectKinds?: SchemaObjectKind[];
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
 * A fresh editor tab. Lives here rather than in the component because the
 * cache is what reads it back, and both sides must agree on the defaults the
 * absent fields stand for.
 */
export function blankQueryTab(title = "Query 1", sql = "SELECT 1;"): CachedQueryTab {
  return {
    id: crypto.randomUUID(),
    title,
    sql,
    resultTabs: [],
    fetchSize: DEFAULT_FETCH_SIZE,
    nextResultIndex: 1
  };
}

/**
 * The workspace as it was stored before the editor gained tabs: one implicit
 * editor holding every result. Wrapping it keeps a draft the user left open
 * from vanishing on upgrade — the alternative is a silent data loss that only
 * shows up as "my query is gone".
 */
interface LegacyWorkspaceState {
  sql?: string;
  activeResultTabId?: string;
  resultTabs?: CachedResultTab[];
  selectedDatabase?: string;
  selectedSchema?: string;
  catalogCollapsed?: boolean;
  objectKinds?: SchemaObjectKind[];
}

function isLegacy(state: unknown): state is LegacyWorkspaceState {
  return Boolean(state) && typeof state === "object" && !Array.isArray((state as DbWorkspaceState).queryTabs);
}

function migrateLegacy(state: LegacyWorkspaceState): DbWorkspaceState {
  const resultTabs = state.resultTabs ?? [];
  // Number on from whatever the old strip held, so a migrated draft does not
  // hand its next run a name it already used.
  const nextResultIndex = resultTabs.length + 1;
  return {
    queryTabs: [
      {
        id: crypto.randomUUID(),
        title: "Query 1",
        sql: state.sql ?? "",
        resultTabs,
        activeResultTabId: state.activeResultTabId,
        fetchSize: DEFAULT_FETCH_SIZE,
        nextResultIndex
      }
    ],
    activeQueryTabId: undefined,
    selectedDatabase: state.selectedDatabase,
    selectedSchema: state.selectedSchema,
    catalogCollapsed: state.catalogCollapsed,
    objectKinds: state.objectKinds
  };
}

/**
 * Drop oversized result bodies before persisting. A whole-result cache keeps
 * everything when it fits the row budget and a rough byte budget; otherwise
 * the rows are dropped but the tab's identity (title/sql/timing/arrangement)
 * survives so the user can rerun with one click.
 */
function fitResultTab(tab: CachedResultTab): CachedResultTab {
  if (!tab.result) return tab;
  const withinRowBudget = tab.result.rows.length <= RESULT_CACHE_ROW_BUDGET;
  const serialized = withinRowBudget ? JSON.stringify(tab.result) : "";
  if (withinRowBudget && serialized.length <= 1_000_000) return tab;
  return { ...tab, result: undefined };
}

/**
 * Read a stored result tab the way the current pane means it.
 *
 * `view` once had `"record"` as one of its three values. A stored `"record"` was
 * a grid read one row at a time, which is the pair `"grid"` + `singleRecord`
 * means now — so it comes back as that, rather than falling through to the grid
 * with the record panel shut and quietly losing what the user had opened.
 */
function normalizeResultTab(tab: CachedResultTab): CachedResultTab {
  if ((tab.view as string | undefined) !== "record") return tab;
  return { ...tab, view: "grid", singleRecord: true };
}

function normalizeState(state: DbWorkspaceState): DbWorkspaceState {
  return {
    ...state,
    queryTabs: state.queryTabs.map((queryTab) => ({
      ...queryTab,
      resultTabs: (queryTab.resultTabs ?? []).map(normalizeResultTab)
    }))
  };
}

export function readDbWorkspace(accountId: string, connectionId: string): DbWorkspaceState {
  const stored = readJson<DbWorkspaceState | LegacyWorkspaceState>(
    storageKey(accountId, connectionId)
  );
  if (!stored) return { queryTabs: [] };
  if (isLegacy(stored)) return normalizeState(migrateLegacy(stored));
  return normalizeState(stored);
}

export function writeDbWorkspace(accountId: string, connectionId: string, state: DbWorkspaceState) {
  const queryTabs = state.queryTabs.slice(-MAX_QUERY_TABS).map((queryTab) => ({
    ...queryTab,
    resultTabs: queryTab.resultTabs.slice(-MAX_RESULT_TABS).map(fitResultTab)
  }));
  writeJson(storageKey(accountId, connectionId), { ...state, queryTabs });
}

export function clearDbWorkspace(accountId: string, connectionId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(accountId, connectionId));
  } catch {
    // ignore
  }
}
