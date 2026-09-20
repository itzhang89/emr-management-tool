import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  MAX_FETCH_SIZE,
  type CachedResultTab,
  type ResultView
} from "@/services/dbWorkspaceCache";
import type { DbQueryResult } from "@/types/domain";
import { ResultBottomBar } from "./ResultBottomBar";
import { ResultGrid } from "./ResultGrid";
import { ResultRecordView } from "./ResultRecordView";
import { ResultTextView } from "./ResultTextView";
import { ResultViewRail } from "./ResultViewRail";

/**
 * One result tab's body: the view rail, whichever of the three views is
 * showing, and the strip that acts on the result as a whole.
 *
 * The arrangement — which view, what is sorted, what is grouped, which row is
 * selected — is *tab state*, not component state, so it is handed back up
 * through `onPatch` and persisted with the tab. Coming back to a result should
 * land in the grid the user built, not a fresh one.
 *
 * Paging, counting and exporting are different in kind: each one re-runs or
 * reaches past the page, so they stay as explicit callbacks rather than
 * something this component could do to itself.
 */
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
        <ResultHeader meta={meta} analyzeButton={analyzeButton} />
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
      </div>
    );
  }

  const view: ResultView = meta.view ?? "grid";
  const rowCount = result.rows.length;
  const recordIndex = Math.min(meta.recordIndex ?? 0, Math.max(rowCount - 1, 0));
  const lastOffset = lastPageOffset(meta, fetchSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ResultHeader meta={meta} analyzeButton={analyzeButton} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ResultViewRail
          view={view}
          recordDisabled={rowCount === 0}
          onChange={(next) => onPatch({ view: next })}
        />

        {view === "grid" ? (
          <ResultGrid
            columns={result.columns}
            rows={result.rows}
            offset={offset}
            sort={meta.sort ?? []}
            onSortChange={(sort) => onPatch({ sort })}
            groupBy={meta.groupBy ?? []}
            onGroupByChange={(groupBy) => onPatch({ groupBy })}
            // Folding is keyed by group path, and a different grouping has
            // different paths — so changing what is grouped starts unfolded
            // rather than inheriting folds that no longer mean anything.
            collapsed={new Set(meta.collapsedGroups ?? [])}
            onCollapsedChange={(collapsed) => onPatch({ collapsedGroups: [...collapsed] })}
            selectedIndex={meta.recordIndex}
            onSelectRow={(recordIndex) => onPatch({ recordIndex })}
          />
        ) : view === "text" ? (
          <ResultTextView columns={result.columns} rows={result.rows} />
        ) : (
          <ResultRecordView
            columns={result.columns}
            rows={result.rows}
            index={recordIndex}
            onIndexChange={(recordIndex) => onPatch({ recordIndex })}
          />
        )}
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

/** Title, run outcome, and the AI action — the tab's identity, not its data. */
function ResultHeader({
  meta,
  analyzeButton
}: {
  meta: CachedResultTab;
  analyzeButton?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
      <span className="truncate font-medium text-foreground">{meta.title}</span>
      {meta.runState === "cancelled" ? <span>{t("Cancelled")}</span> : null}
      {meta.runState === "failed" ? (
        <span className="text-destructive">Failed{meta.runError ? `: ${meta.runError}` : ""}</span>
      ) : null}
      {analyzeButton ? <div className="ml-auto flex items-center gap-1">{analyzeButton}</div> : null}
    </div>
  );
}
