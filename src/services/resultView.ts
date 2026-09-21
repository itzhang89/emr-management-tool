/**
 * How a result is *arranged*, and what a pane needs in order to draw one.
 *
 * These live here rather than beside either workspace's storage because neither
 * of them owns the idea: a grid, a sort order and a set of conditions on a
 * column mean the same thing whether the rows came back from a JDBC connection
 * or from Athena. `dbWorkspaceCache` persists them for DBHub and re-exports
 * them; Glue keeps them in memory. The components that read them are shared, so
 * the vocabulary has to be too.
 */

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
 * How a cell's value is compared. The five the right-click menu offers, in the
 * order it shows them: equal, not equal, greater, less, and a pattern match.
 * The typed expression spells the same five — `=`, `<>`, `>`, `<`, `LIKE` — and
 * `IS [NOT] NULL` for a missing value, which is `eq`/`ne` with `isNull` set.
 */
export type FilterOperator = "eq" | "ne" | "gt" | "lt" | "like";

/**
 * One condition on a column, however it was asked for — chosen from a cell's
 * right-click menu, or typed into the filter box as SQL.
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

/**
 * What a result pane reads off a tab, and writes back into it.
 *
 * The pane holds no state of its own — which format, whether the record panel
 * is open, what is sorted and what is filtered out are all facts about the
 * result, so they belong to whoever owns the result tab and not to the thing
 * drawing it. This is the whole of what passes between them, which is what lets
 * one pane serve two workspaces whose tab types are otherwise unrelated:
 * `CachedResultTab` satisfies it, and so does Glue's `QueryResultTab`.
 */
export interface ResultPaneMeta {
  /**
   * The statement that produced the rows. Shown above them, because the answer
   * means nothing without the question.
   */
  sql: string;
  view?: ResultView;
  /** Open the record panel under the rows, showing `recordIndex` transposed. */
  singleRecord?: boolean;
  sort?: ColumnSort[];
  /**
   * What the filter box holds, as it was typed — which is not always what is
   * applied: text that does not parse is kept so the user comes back to their
   * own words rather than to a box that silently emptied itself, while
   * `filters` stays on the last conditions that did parse.
   */
  filterText?: string;
  /** Conditions every drawn row has to satisfy, in the order they were added. */
  filters?: CellFilter[];
  /** Which row the record panel is on, and the one the grid highlights. */
  recordIndex?: number;
  /** Set when the last run did not simply succeed, so a reload still says so. */
  runState?: "cancelled" | "failed";
  runError?: string;
  /**
   * Why there are no rows, when it is not one of `runState`'s two.
   *
   * The pane's third case is the cache budget — a result that exists but was
   * too big to keep — and that is a DBHub fact, not a general one: a workspace
   * that keeps its rows in memory has no budget to exceed, and would be
   * explaining a limit it does not have. Athena's two cases are a page still on
   * its way and a page that failed to arrive, and those are what this says.
   * Absent means the cache sentence, which is what DBHub means by it.
   */
  emptyReason?: "pending" | "unavailable";
  durationMs?: number;
  ranAt?: string;
  /** Total rows the statement would return. Absent until asked. */
  totalCount?: number;
  /** Why there is no number, when the last count did not produce one. */
  countError?: string;
}

/**
 * The rows themselves, and what they are called.
 *
 * Narrower than either workspace's result type on purpose: a pane draws rows
 * and names them, and knows nothing about offsets, cursors or whether the
 * engine would hand over another page. `DbQueryResult` satisfies this as it
 * stands; Athena's `string[][]` is turned into one by `athenaRowsToRecords`.
 */
export interface ResultRows {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}
