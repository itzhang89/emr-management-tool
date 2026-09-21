import { useMemo } from "react";
import { ResultPane } from "@/components/sql/result/ResultPane";
import type { ResultExportOption, ResultPaging } from "@/components/sql/result/ResultBottomBar";
import { useT } from "@/i18n";
import { athenaRowsToRecords } from "@/services/athenaResultRows";
import type { QueryResultTab } from "@/services/queryResultTabs";
import type { ResultPaneMeta } from "@/services/resultView";

/**
 * Athena's result tab, drawn by the pane the two workspaces share.
 *
 * All this adds is translation. A Glue result tab and a DBHub one have almost
 * nothing in common — one holds a cursor and an execution, the other an offset
 * and a cache row budget — so rather than bending either type into the other's
 * shape, the fields the pane reads are assembled here, one at a time, from
 * whichever of the tab's own facts stands for them. That is also what keeps
 * `runState`, `durationMs` and the rest out of `QueryResultTab`: they are pure
 * functions of the execution, and a copy of them stored on the tab would be a
 * second version of the truth to keep in step.
 */

/** Bytes at the size a person reads them. Athena reports scanned data this way. */
function formatBytes(value?: number) {
  if (value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function AthenaResultPane({
  tab,
  exporting,
  onPatch,
  onRefresh,
  onStop,
  onLoadMore,
  onExport
}: {
  tab: QueryResultTab;
  exporting: boolean;
  onPatch: (patch: Partial<QueryResultTab>) => void;
  onRefresh: () => void;
  onStop: () => void;
  onLoadMore: () => void;
  onExport: () => void;
}) {
  const t = useT();
  const execution = tab.execution;

  // Keyed on the page set and nothing else. `patchResultTab` hands back a new
  // tab object for every edit — a sort, a click in the filter box — while
  // leaving the rows themselves alone, so keying on the tab would rebuild every
  // record and re-sort the whole accumulated set on each keystroke.
  const result = useMemo(
    () => (tab.results ? athenaRowsToRecords(tab.results) : undefined),
    [tab.results]
  );

  // Nothing has run yet. `meta` absent is the pane's own "nothing here" state,
  // which is the sentence the strip shows for an editor with no result tabs at
  // all — the same fact, said the same way, without a second copy of it here.
  const meta: ResultPaneMeta | undefined = execution
    ? {
        sql: tab.sqlSnapshot,
        view: tab.view,
        singleRecord: tab.singleRecord,
        sort: tab.sort,
        filterText: tab.filterText,
        filters: tab.filters,
        recordIndex: tab.recordIndex,
        runState: runStateOf(execution.state),
        runError: execution.stateChangeReason,
        // The engine's own time, which is what "engine time" meant on this pane
        // before it was shared: the cluster's duration slot is exactly that fact.
        durationMs: execution.engineExecutionTimeMs,
        ranAt: execution.completionDateTime,
        // No total: Athena has no cheap count, and the strip does not offer one
        // for a cursor. The row count in the cluster is the rows in hand.
        emptyReason: tab.resultsError
          ? "unavailable"
          : isRunning(execution.state) || tab.resultsLoading
            ? "pending"
            : undefined
      }
    : undefined;

  // Offered only for a run that produced something to write: Athena's export
  // downloads the whole result from S3, and a failed or unfinished run has no
  // result there to download.
  const exportOptions: ResultExportOption[] =
    execution?.state === "SUCCEEDED"
      ? [
          {
            label: t("Export CSV"),
            hint: t("the whole result, as Athena wrote it to S3"),
            disabled: exporting,
            onSelect: onExport
          }
        ]
      : [];

  return (
    <ResultPane
      meta={meta}
      result={result}
      running={execution ? isRunning(execution.state) : false}
      paging={{
        mode: "cursor",
        hasMore: Boolean(tab.results?.nextToken),
        loading: tab.resultsLoading ?? false,
        onLoadMore
      }}
      exportOptions={exportOptions}
      exporting={exporting}
      status={
        execution ? (
          <span>
            {t("Scanned:")} {formatBytes(execution.dataScannedBytes)}
          </span>
        ) : undefined
      }
      onPatch={onPatch}
      onRefresh={onRefresh}
      onStop={onStop}
      // No `analyzeButton`: the AI rail is DBHub's for now, and the rail draws
      // nothing at all when it is given nothing, so there is no empty gutter
      // where a button would go.
    />
  );
}

/** Whether a run is still going, which is what keeps the strip's Stop live. */
export function isRunning(state: string): boolean {
  return state === "QUEUED" || state === "RUNNING";
}

/** Athena's two unhappy endings, in the pane's vocabulary. */
function runStateOf(state: string): "cancelled" | "failed" | undefined {
  if (state === "FAILED") return "failed";
  if (state === "CANCELLED") return "cancelled";
  return undefined;
}
