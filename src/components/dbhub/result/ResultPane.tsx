import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  MAX_FETCH_SIZE,
  type CachedResultTab,
  type CellFilter,
  type ColumnSort,
  type ResultView
} from "@/services/dbWorkspaceCache";
import type { DbQueryResult } from "@/types/domain";
import { ResultBottomBar } from "./ResultBottomBar";
import { ResultFilterBar } from "./ResultFilterBar";
import { ResultFilterChips } from "./ResultFilterChips";
import { ResultFunctionRail } from "./ResultFunctionRail";
import { ResultGrid } from "./ResultGrid";
import { ResultRecordPanel } from "./ResultRecordPanel";
import { ResultTextView } from "./ResultTextView";
import { ResultViewRail } from "./ResultViewRail";
import { addFilter, expressionFor, filterRows } from "./resultFilter";
import { sortRows, type IndexedRow, type Row } from "./resultGridModel";

/**
 * One result tab's body: the line naming what was asked and narrowing it, the
 * format rail down the left edge, the data in the middle, the function rail
 * down the right, and the strip that acts on the result as a whole underneath.
 *
 * The two rails begin at the table's own header row rather than at the top of
 * the pane, which is what the line above them buys: the SQL and the filter box
 * are facts about the result as a whole, so they span it, and what is left
 * between them is the table and nothing else.
 *
 * The page is split across the middle by the record panel. Above the line: the
 * rows — grid or text — with the function rail beside them. Below it, when
 * Record is on: the selected row, transposed, with its own way of stepping to
 * the next one. The format rail is the only thing that spans both halves,
 * because it holds a switch for each of them — the two formats at the top,
 * Record at the foot.
 *
 * Record is a second pane rather than a third format. DBeaver opens it this way
 * and the reason is visible in the layout: a row is easier to read transposed
 * for its long columns, but only while the row it came from is still on screen
 * above it, in its place on the page. Narrowing the grid to one row would take
 * that away, and would also take the page away from whoever wanted to compare
 * the record against its neighbours. So the grid keeps drawing the whole page
 * and the panel mirrors one row of it.
 *
 * The arrangement — which format, whether the record panel is open, what is
 * sorted, what is filtered out, which row is selected — is *tab state*, not
 * component state, so it is handed back up through `onPatch` and persisted with
 * the tab. Coming back to a result should land in the grid the user built, not
 * a fresh one.
 *
 * The order the grid draws is worked out here rather than inside the grid, so
 * that the numbers down its side and the record panel's own count come from one
 * place: a row's place on the page is decided once, by this component, and both
 * panes read it off the same pairing. The filter narrows that pairing rather
 * than the page, which is why a filtered grid still numbers its rows the way the
 * page numbered them — the numbers say where a row came from, not how many rows
 * are left.
 *
 * Paging, counting and exporting are different in kind: each one re-runs or
 * reaches past the page, so they stay as explicit callbacks rather than
 * something this component could do to itself.
 */

/**
 * Shared empties. `meta.sort ?? []` would hand the memos a fresh array on every
 * render and recompute the order each time, so the absent case gets one array
 * for the life of the module.
 */
const NO_SORT: ColumnSort[] = [];
const NO_FILTERS: CellFilter[] = [];
const NO_ROWS: Row[] = [];
const NO_COLUMNS: string[] = [];

export function ResultPane({
  meta,
  result,
  running,
  counting,
  offset,
  fetchSize,
  onPatch,
  onFetchSizeChange,
  onRefresh,
  onFirst,
  onPrev,
  onNext,
  onLast,
  onExport,
  onStop,
  onCount,
  analyzeButton
}: {
  meta?: CachedResultTab;
  result?: DbQueryResult;
  running: boolean;
  counting: boolean;
  offset: number;
  fetchSize: number;
  onPatch: (patch: Partial<CachedResultTab>) => void;
  /** Stored, not applied: the size takes effect on the next run of the tab. */
  onFetchSizeChange: (size: number) => void;
  onRefresh: () => void;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onExport: (format: "csv" | "json") => void;
  onStop: () => void;
  onCount: () => void;
  analyzeButton?: ReactNode;
}) {
  const t = useT();

  const pageRows = result?.rows ?? NO_ROWS;
  const rowCount = pageRows.length;
  const sort = meta?.sort ?? NO_SORT;
  const filters = meta?.filters ?? NO_FILTERS;
  const view: ResultView = meta?.view ?? "grid";
  const single = meta?.singleRecord === true;

  /** A row's place on the page, looked up rather than searched for each time. */
  const pageIndexOf = useMemo(() => {
    const places = new Map<Row, number>();
    pageRows.forEach((row, index) => places.set(row, index));
    return places;
  }, [pageRows]);

  const sorted = useMemo(() => sortRows(pageRows, sort), [pageRows, sort]);

  // The page in draw order, narrowed to the rows the filters kept — each still
  // carrying the number it had before either happened, so the grid's own column
  // goes on saying where a row came from rather than renumbering what is left.
  // See `IndexedRow`.
  const visible = useMemo<IndexedRow[]>(
    () =>
      filterRows(sorted, filters).map((row) => ({ row, index: pageIndexOf.get(row) ?? 0 })),
    [sorted, filters, pageIndexOf]
  );

  /**
   * Where a page row sits in what is drawn, which is the direction the record
   * panel counts in: it steps through the rows on screen, not through the rows
   * the page arrived with. Without a filter the two are the same order, so the
   * stored `recordIndex` keeps meaning what it always did.
   */
  const visiblePlaceOf = useMemo(() => {
    const places = new Map<number, number>();
    visible.forEach((entry, place) => places.set(entry.index, place));
    return places;
  }, [visible]);

  const recordIndex = Math.min(meta?.recordIndex ?? 0, Math.max(visible.length - 1, 0));

  // Record is a panel under the rows, so it needs rows to put under them. Its
  // own switch stays visible either way — a control that vanishes reads as a
  // layout change, not as "there is nothing to show".
  const showRecord = single && visible.length > 0;

  if (!meta) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t("Run a query to see results here.")}
      </div>
    );
  }

  // No rows cached, for one of three reasons — and saying which matters: the
  // budget message is about a result that exists but was not kept, while the
  // other two are runs that never produced one.
  if (!result) {
    const state = meta.runState;
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* The statement still heads the pane — it is what there is to show —
            but with no rows in hand there is nothing for a filter to narrow, so
            the box is left off rather than offered and ignored. */}
        <ResultFilterBar
          sql={meta.sql}
          columns={NO_COLUMNS}
          runState={meta.runState}
          runError={meta.runError}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
            <p>
              {state === "cancelled"
                ? t("Stopped before it returned any rows.")
                : state === "failed"
                  ? t("The run failed, so there are no rows to show.")
                  : t("The result set exceeded the local cache budget, so only this tab's metadata was kept.")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              disabled={running}
              onClick={onRefresh}
            >
              {t("Rerun to load fresh results")}
            </Button>
          </div>
          {/* No columns are known yet, so the rail is the AI action alone. */}
          <ResultFunctionRail analyzeButton={analyzeButton} />
        </div>
      </div>
    );
  }

  const lastOffset = lastPageOffset(meta, fetchSize);

  /**
   * Take a set of conditions as the new state, text included.
   *
   * The text is rewritten from the conditions rather than the other way round,
   * because a chip taken off is an edit to what is being filtered, and the box
   * is only where that is written down. Writing it from the labels also
   * normalises what the user typed — `!=` comes back as `<>` — which is what
   * keeps the box and the chips from drifting apart.
   */
  const applyFilters = (next: CellFilter[]) =>
    // Any change to the conditions changes which rows are on screen, so a
    // record number from before them would point at a row that is no longer
    // there: start at the first one that survived.
    onPatch({ filters: next, filterText: expressionFor(next), recordIndex: 0 });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ResultFilterBar
        sql={meta.sql}
        text={meta.filterText ?? ""}
        columns={result.columns}
        runState={meta.runState}
        runError={meta.runError}
        onCommit={(text, terms) =>
          // Text that did not parse keeps the conditions in force — the box has
          // already said why — and is stored all the same, so coming back to
          // the tab lands on the user's own words.
          onPatch(terms ? { filterText: text, filters: terms, recordIndex: 0 } : { filterText: text })
        }
      />
      {filters.length > 0 ? (
        <ResultFilterChips
          filters={filters}
          kept={visible.length}
          total={rowCount}
          onRemove={(at) => applyFilters(filters.filter((_, index) => index !== at))}
          onClear={() => applyFilters([])}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* The one element that spans both panes: the formats belong to the
            rows above the line, the Record switch to the panel below it. */}
        <ResultViewRail
          view={view}
          single={single}
          onChange={(next) => onPatch({ view: next })}
          onSingleChange={(next) => onPatch({ singleRecord: next })}
          recordDisabled={visible.length === 0}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-[3] overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {view === "text" ? (
                <ResultTextView
                  columns={result.columns}
                  rows={visible.map((entry) => entry.row)}
                  pageCount={rowCount}
                />
              ) : (
                <ResultGrid
                  columns={result.columns}
                  rows={visible}
                  offset={offset}
                  sort={sort}
                  onSortChange={(sort) => onPatch({ sort })}
                  filtered={filters.length > 0}
                  onFilter={(filter) => {
                    // Asking one question twice is asking it once, so a
                    // condition already in force changes nothing — see
                    // `addFilter`.
                    const next = addFilter(filters, filter);
                    if (next !== filters) applyFilters(next);
                  }}
                  // The grid marks the row the panel is showing, so the two
                  // panes always agree about which record is on screen — and
                  // marks nothing while the panel is shut, because then no
                  // record is the selected one. The mark is the row's place on
                  // the page, which is the number the grid draws beside it.
                  selectedIndex={showRecord ? visible[recordIndex]?.index : undefined}
                  onSelectRow={(index) => onPatch({ recordIndex: visiblePlaceOf.get(index) ?? 0 })}
                />
              )}
            </div>

            <ResultFunctionRail analyzeButton={analyzeButton} />
          </div>

          {showRecord ? (
            <ResultRecordPanel
              columns={result.columns}
              row={visible[recordIndex]?.row}
              index={recordIndex}
              total={visible.length}
              onIndexChange={(recordIndex) => onPatch({ recordIndex })}
            />
          ) : null}
        </div>
      </div>

      <ResultBottomBar
        offset={offset}
        rowCount={rowCount}
        fetchSize={fetchSize}
        onFetchSizeChange={onFetchSizeChange}
        pageable={result.pageable}
        hasPrev={offset > 0}
        hasNext={result.nextOffset != null}
        hasLast={lastOffset !== undefined && lastOffset !== offset}
        onFirst={onFirst}
        onPrev={onPrev}
        onNext={onNext}
        onLast={onLast}
        onRefresh={onRefresh}
        onExport={onExport}
        onStop={onStop}
        running={running}
        durationMs={meta.durationMs}
        fetchedAt={meta.ranAt}
        totalCount={meta.totalCount}
        countError={meta.countError}
        counting={counting}
        onCount={onCount}
      />
    </div>
  );
}

/**
 * Where the final page starts, once a count has said how many rows there are.
 * Undefined until then — "last" is not somewhere you can go without knowing
 * how many rows the statement returns. Shared with the workspace, which has to
 * send the offset the button promises.
 */
export function lastPageOffset(
  meta: Pick<CachedResultTab, "totalCount">,
  fetchSize: number
): number | undefined {
  if (meta.totalCount === undefined) return undefined;
  const size = pageSize(fetchSize);
  return Math.floor(Math.max(meta.totalCount - 1, 0) / size) * size;
}

/**
 * Where the page before this one starts.
 *
 * A whole page back, not a page's worth of rows: the page on screen may be the
 * last one, and a last page is short. Stepping back by its own row count would
 * land *inside* the page before it — the rows between would be skipped and the
 * user would never know. Every page except the last was full, so the size is
 * what separates two of them.
 *
 * Shared with the workspace for the same reason as `lastPageOffset`: the
 * button on screen must promise the offset the request will actually use.
 */
export function previousPageOffset(offset: number, fetchSize: number): number {
  return Math.max(0, offset - pageSize(fetchSize));
}

/** The size the backend will really page by — it clamps to `MAX_PAGE_ROWS`. */
function pageSize(fetchSize: number): number {
  return Math.min(Math.max(fetchSize, 1), MAX_FETCH_SIZE);
}
