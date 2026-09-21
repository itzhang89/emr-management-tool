import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Hash,
  Loader2,
  RefreshCw,
  Settings2,
  Square
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { localeTag, useLocale, useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The strip under the rows: everything that acts on the result as a whole.
 *
 * Two of its actions mean the same thing wherever the rows came from — refresh
 * them, or stop the run producing them — and those are written once here. What
 * the rest of the strip can offer depends on the engine, so it is named rather
 * than inferred from which callbacks happen to be present.
 *
 * Paging is where the engines genuinely part company, and it is the reason the
 * strip is not simply DBHub's with the numbers taken out. A JDBC connection
 * pages by *offset*, and only where the statement can be re-run cheaply enough
 * to justify it (`pageable`): every page re-runs the statement and discards the
 * rows it skips, so stepping forward costs what the query costs, and the count
 * is a button rather than a label because getting it re-runs the whole
 * statement inside a `COUNT(*)`. Athena hands back a cursor instead — forward
 * only, no offset, no total — so its half of the strip is one button that
 * appends the next page. The union below is what keeps either workspace from
 * being handed the other's controls: neither is offered a control it cannot
 * honour, because neither is offered a control at all.
 *
 * Export is data rather than a callback for that same reason. The *hint* under
 * each format is a claim about what the file will contain, and the claim is
 * engine-specific: a JDBC export writes the rows loaded here, while Athena's is
 * a server-side download of the whole result. One `onExport` shared between
 * them would have to lie to one of them, so each brings its own options and why
 * they are what they are.
 */

export interface ResultExportOption {
  /** The button's own label, and the popover item's leading line. */
  label: string;
  /** What the file will hold. Only the popover has room to say it. */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * How this result pages, or that it does not.
 *
 * `maxFetchSize` rides along as a *value* rather than being imported from
 * wherever it is defined, so this component — and everything else in the shared
 * result area — need know nothing about either workspace's storage.
 */
export type ResultPaging =
  | {
      mode: "offset";
      offset: number;
      fetchSize: number;
      maxFetchSize: number;
      /** Stored, not applied: the size takes effect on the next run of the tab. */
      onFetchSizeChange: (size: number) => void;
      /** Whether the statement can be re-run at an offset at all. */
      pageable: boolean;
      hasPrev: boolean;
      hasNext: boolean;
      /** Only knowable once a count has been run. */
      hasLast: boolean;
      onFirst: () => void;
      onPrev: () => void;
      onNext: () => void;
      onLast: () => void;
      counting: boolean;
      onCount: () => void;
      totalCount?: number;
      countError?: string;
    }
  | {
      mode: "cursor";
      hasMore: boolean;
      loading: boolean;
      onLoadMore: () => void;
    };

export function ResultBottomBar({
  rowCount,
  running,
  paging,
  exportOptions,
  exporting,
  status,
  onRefresh,
  onStop,
  durationMs,
  fetchedAt
}: {
  rowCount: number;
  running: boolean;
  paging: ResultPaging;
  exportOptions: ResultExportOption[];
  exporting?: boolean;
  /** Facts only some engines know — Athena's scanned bytes — leading the cluster. */
  status?: ReactNode;
  onRefresh: () => void;
  onStop: () => void;
  durationMs?: number;
  fetchedAt?: string;
}) {
  const t = useT();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-t px-2 py-1 text-[10px] text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-[10px]"
        disabled={running}
        onClick={onRefresh}
      >
        <RefreshCw className={cn("size-3", running && "animate-spin")} />
        {t("Refresh")}
      </Button>

      {/* Stop takes Cancel's place in DBeaver's strip: there is nothing to save
          here, and the one thing worth interrupting is the run itself. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-[10px]"
        disabled={!running}
        onClick={onStop}
      >
        <Square className="size-3" />
        {t("Stop")}
      </Button>

      {/* Each group carries its own leading rule rather than the one before it
          carrying a trailing one, so a group that is not there — the pager on a
          cursor, the count on an engine that cannot page — does not leave a
          divider standing over nothing. */}
      {paging.mode === "offset" ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <Pager paging={paging} />
        </>
      ) : (
        <LoadMore paging={paging} />
      )}

      {exportOptions.length > 0 ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {exportOptions.length === 1 ? (
            <SingleExport option={exportOptions[0]!} exporting={exporting} />
          ) : (
            <ExportMenu options={exportOptions} exporting={exporting} />
          )}
        </>
      ) : null}

      {paging.mode === "offset" ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <PageSizeAndCount paging={paging} />
        </>
      ) : null}

      <StatusCluster
        rowCount={rowCount}
        paging={paging}
        status={status}
        durationMs={durationMs}
        fetchedAt={fetchedAt}
      />
    </div>
  );
}

/**
 * How many rows are here, where they sit, how long they took and when they
 * arrived.
 *
 * Only an offset pager knows where its rows sit in the whole result. A cursor
 * hands back what it hands back, and saying "rows 1–1000" of a total nobody has
 * would be inventing the total.
 */
function StatusCluster({
  rowCount,
  paging,
  status,
  durationMs,
  fetchedAt
}: {
  rowCount: number;
  paging: ResultPaging;
  status?: ReactNode;
  durationMs?: number;
  fetchedAt?: string;
}) {
  const t = useT();
  const locale = useLocale();

  const ranges = paging.mode === "offset" && paging.pageable && rowCount > 0;
  const firstRow = rowCount === 0 ? 0 : paging.mode === "offset" ? paging.offset + 1 : 0;
  const lastRow = paging.mode === "offset" ? paging.offset + rowCount : rowCount;

  return (
    <span className="ml-auto flex items-center gap-2 tabular-nums">
      {status}
      <span>
        {t(rowCount === 1 ? "{count} row" : "{count} rows", {
          count: rowCount.toLocaleString(localeTag(locale))
        })}
        {ranges
          ? ` · ${t("rows {from}–{to}", {
              from: firstRow.toLocaleString(localeTag(locale)),
              to: lastRow.toLocaleString(localeTag(locale))
            })}`
          : ""}
      </span>
      {durationMs !== undefined ? <span>{formatDuration(durationMs)}</span> : null}
      {fetchedAt ? (
        <span>{t("updated {at}", { at: new Date(fetchedAt).toLocaleString(localeTag(locale)) })}</span>
      ) : null}
    </span>
  );
}

/**
 * Athena's half: one button that asks for the next page.
 *
 * Absent rather than disabled once the token is spent — a control that can
 * never do anything again reads as a layout change, not as "there is no more".
 */
function LoadMore({ paging }: { paging: Extract<ResultPaging, { mode: "cursor" }> }) {
  const t = useT();
  if (!paging.hasMore) return null;

  return (
    <>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-[10px]"
        // Disabled while a page is in flight: clicking twice would ask for the
        // same token twice and append the same rows twice.
        disabled={paging.loading}
        onClick={paging.onLoadMore}
      >
        {paging.loading ? <Loader2 className="size-3 animate-spin" /> : <ChevronRight className="size-3" />}
        {t("Load more rows")}
      </Button>
    </>
  );
}

/** DBeaver's pager, for a JDBC page. */
function Pager({ paging }: { paging: Extract<ResultPaging, { mode: "offset" }> }) {
  const t = useT();
  const { pageable } = paging;

  return (
    <div className="flex items-center">
      <PagerButton label="First page" disabled={!pageable || !paging.hasPrev} onClick={paging.onFirst}>
        <ChevronsLeft className="size-3" />
      </PagerButton>
      <PagerButton label="Previous page" disabled={!pageable || !paging.hasPrev} onClick={paging.onPrev}>
        <ChevronLeft className="size-3" />
      </PagerButton>
      <PagerButton
        label={t("Next page · re-runs the query")}
        disabled={!pageable || !paging.hasNext}
        onClick={paging.onNext}
      >
        <ChevronRight className="size-3" />
      </PagerButton>
      <PagerButton
        label={t("Last page · needs a row count first")}
        disabled={!pageable || !paging.hasLast}
        onClick={paging.onLast}
      >
        <ChevronsRight className="size-3" />
      </PagerButton>
    </div>
  );
}

/** How many rows a page holds, and the button that counts them all. */
function PageSizeAndCount({ paging }: { paging: Extract<ResultPaging, { mode: "offset" }> }) {
  const t = useT();
  const locale = useLocale();
  const { fetchSize, maxFetchSize, counting, totalCount, countError } = paging;
  const [fetchDraft, setFetchDraft] = useState(String(fetchSize));

  // The input is uncontrolled while being typed in — clamping every keystroke
  // would fight anyone clearing the field to retype it.
  useEffect(() => setFetchDraft(String(fetchSize)), [fetchSize]);

  const commitFetchSize = () => {
    const parsed = Number.parseInt(fetchDraft, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setFetchDraft(String(fetchSize));
      return;
    }
    const clamped = Math.min(maxFetchSize, parsed);
    setFetchDraft(String(clamped));
    if (clamped !== fetchSize) paging.onFetchSizeChange(clamped);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1">
            <Settings2 className="size-3" />
            <input
              value={fetchDraft}
              onChange={(event) => setFetchDraft(event.target.value)}
              onBlur={commitFetchSize}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setFetchDraft(String(fetchSize));
              }}
              inputMode="numeric"
              aria-label={t("Rows per page")}
              className="h-5 w-12 rounded-sm border bg-background px-1 text-center text-[10px] tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {t("Rows per page · takes effect on the next run, up to {max}", {
            max: String(maxFetchSize)
          })}
        </TooltipContent>
      </Tooltip>

      {/* The count, and the button that gets it. One control, because a
          separate "count" button beside a blank label reads as a mystery. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[10px] tabular-nums"
            disabled={counting}
            onClick={paging.onCount}
          >
            {counting ? <Loader2 className="size-3 animate-spin" /> : <Hash className="size-3" />}
            {totalCount !== undefined ? (
              <span className="font-medium text-foreground">
                {totalCount.toLocaleString(localeTag(locale))}
              </span>
            ) : (
              t("Count")
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {countError
            ? countError
            : totalCount !== undefined
              ? t("Total rows · runs COUNT(*) over the whole statement")
              : t("Count all rows · re-runs the query inside COUNT(*), which can be slow")}
        </TooltipContent>
      </Tooltip>
    </>
  );
}

/** One format, so there is no menu to open: the button is the action. */
function SingleExport({
  option,
  exporting
}: {
  option: ResultExportOption;
  exporting?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 gap-1 px-1.5 text-[10px]"
      disabled={exporting || option.disabled}
      onClick={option.onSelect}
    >
      <Download className="size-3" />
      {option.label}
    </Button>
  );
}

/**
 * Several formats, behind the one button. Each item is its label first and its
 * caveat second, because the label is what is being chosen and the caveat is
 * what the choice costs.
 */
function ExportMenu({
  options,
  exporting
}: {
  options: ResultExportOption[];
  exporting?: boolean;
}) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[10px]"
          disabled={exporting}
        >
          <Download className="size-3" />
          {t("Export")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1 text-[11px]">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={option.disabled}
            className="w-full rounded-sm px-2 py-1 text-left hover:bg-muted disabled:opacity-50"
            onClick={option.onSelect}
          >
            <span className="block font-medium">{option.label}</span>
            {option.hint ? (
              <span className="block text-[10px] text-muted-foreground">{option.hint}</span>
            ) : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={disabled}
          aria-label={t(label)}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t(label)}</TooltipContent>
    </Tooltip>
  );
}

/** Sub-second work reads better in milliseconds than as "0.003s". */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(3)}s`;
}
