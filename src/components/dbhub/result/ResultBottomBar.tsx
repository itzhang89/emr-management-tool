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
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { localeTag, useLocale, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { MAX_FETCH_SIZE } from "@/services/dbWorkspaceCache";

/**
 * The strip under the grid: everything that acts on the result as a whole.
 *
 * Paging is offset-based, and the backend has no cursor to resume from — every
 * page re-runs the statement and discards the rows it skips. So stepping to
 * the next page costs what the query costs, and the controls are only offered
 * where they would actually work (`pageable`).
 *
 * The row count is a button, not a label, because there is no cheap way to get
 * it: the count re-runs the whole statement inside a `COUNT(*)`, which on a
 * warehouse is the same bill as running it again. It is there because somebody
 * asked for it, and it says so before it is pressed.
 */
export function ResultBottomBar({
  offset,
  rowCount,
  fetchSize,
  onFetchSizeChange,
  pageable,
  hasPrev,
  hasNext,
  hasLast,
  onFirst,
  onPrev,
  onNext,
  onLast,
  onRefresh,
  onExport,
  onStop,
  running,
  durationMs,
  fetchedAt,
  totalCount,
  countError,
  counting,
  onCount
}: {
  offset: number;
  rowCount: number;
  fetchSize: number;
  onFetchSizeChange: (size: number) => void;
  pageable: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Only knowable once a count has been run. */
  hasLast: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onRefresh: () => void;
  onExport: (format: "csv" | "json") => void;
  onStop: () => void;
  running: boolean;
  durationMs?: number;
  fetchedAt?: string;
  totalCount?: number;
  countError?: string;
  counting: boolean;
  onCount: () => void;
}) {
  const t = useT();
  const locale = useLocale();
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
    const clamped = Math.min(MAX_FETCH_SIZE, parsed);
    setFetchDraft(String(clamped));
    if (clamped !== fetchSize) onFetchSizeChange(clamped);
  };

  const firstRow = rowCount === 0 ? 0 : offset + 1;
  const lastRow = offset + rowCount;

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

      <span className="mx-0.5 h-4 w-px bg-border" />

      <div className="flex items-center">
        <PagerButton label="First page" disabled={!pageable || !hasPrev} onClick={onFirst}>
          <ChevronsLeft className="size-3" />
        </PagerButton>
        <PagerButton label="Previous page" disabled={!pageable || !hasPrev} onClick={onPrev}>
          <ChevronLeft className="size-3" />
        </PagerButton>
        <PagerButton
          label={t("Next page · re-runs the query")}
          disabled={!pageable || !hasNext}
          onClick={onNext}
        >
          <ChevronRight className="size-3" />
        </PagerButton>
        <PagerButton
          label={t("Last page · needs a row count first")}
          disabled={!pageable || !hasLast}
          onClick={onLast}
        >
          <ChevronsRight className="size-3" />
        </PagerButton>
      </div>

      <span className="mx-0.5 h-4 w-px bg-border" />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[10px]"
          >
            <Download className="size-3" />
            {t("Export")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1 text-[11px]">
          <ExportOption
            label={t("CSV")}
            hint={t("the rows loaded here, not the whole result")}
            onClick={() => onExport("csv")}
          />
          <ExportOption
            label={t("JSON")}
            hint={t("one object per row, as the driver sent it")}
            onClick={() => onExport("json")}
          />
        </PopoverContent>
      </Popover>

      <span className="mx-0.5 h-4 w-px bg-border" />

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
            max: String(MAX_FETCH_SIZE)
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
            onClick={onCount}
          >
            {counting ? <Loader2 className="size-3 animate-spin" /> : <Hash className="size-3" />}
            {totalCount !== undefined ? (
              <span className="font-medium text-foreground">{totalCount.toLocaleString(localeTag(locale))}</span>
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

      <span className="ml-auto flex items-center gap-2 tabular-nums">
        <span>
          {t(rowCount === 1 ? "{count} row" : "{count} rows", {
            count: rowCount.toLocaleString(localeTag(locale))
          })}
          {pageable && rowCount > 0
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
    </div>
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
  children: React.ReactNode;
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

function ExportOption({
  label,
  hint,
  onClick
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
      onClick={onClick}
    >
      <span className="block font-medium">{label}</span>
      <span className="block text-[10px] text-muted-foreground">{hint}</span>
    </button>
  );
}

/** Sub-second work reads better in milliseconds than as "0.003s". */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(3)}s`;
}
