import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ColumnSort } from "@/services/dbWorkspaceCache";
import {
  cellClass,
  cycleSort,
  formatCell,
  sortIndexOf,
  setSortDirection,
  type IndexedRow
} from "./resultGridModel";

/**
 * The grid itself: the columns, their headers, and the rows in the order the
 * sort put them.
 *
 * Two things are worth knowing before reading it.
 *
 * *The page is the world.* Sorting is client-side over the rows the server
 * sent, not over the table. The grid says so where it matters (the text view
 * copies what is loaded, the footer counts what is loaded) rather than letting
 * the user believe a sort reordered a table they cannot see.
 *
 * *Sorting rearranges the view, not the rows.* A row keeps the number it had
 * on the page, so a sorted grid can read 7, 2, 9 — and the number the record
 * panel counts by is the same one. That is why the rows arrive already paired
 * with their places rather than the grid numbering them top to bottom.
 */

export function ResultGrid({
  columns,
  rows,
  offset,
  sort,
  onSortChange,
  selectedIndex,
  onSelectRow
}: {
  columns: string[];
  /** The page in draw order, each row paired with its place in the page. */
  rows: IndexedRow[];
  /** Where this page starts in the whole result, for the row numbers. */
  offset: number;
  sort: ColumnSort[];
  onSortChange: (sort: ColumnSort[]) => void;
  selectedIndex?: number;
  onSelectRow: (index: number) => void;
}) {
  const t = useT();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-[10px]">
          <thead className="sticky top-0 z-10 bg-muted/80">
            <tr>
              {/* The row-number column is the grid's own, so it has no name to
                  sort by. */}
              <th className="w-px border-b border-r px-2 py-1 text-right font-medium text-muted-foreground">
                #
              </th>
              {columns.map((column) => (
                <GridHeaderCell key={column} column={column} sort={sort} onSortChange={onSortChange} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, index }) => (
              <tr
                key={index}
                className={cn(
                  "cursor-default border-b hover:bg-muted/40",
                  selectedIndex === index && "bg-primary/10"
                )}
                onClick={() => onSelectRow(index)}
              >
                <td className="border-r px-2 py-1 text-right text-muted-foreground tabular-nums">
                  {offset + index + 1}
                </td>
                {columns.map((column) => (
                  <GridCell key={column} value={row[column]} />
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-2 py-3 text-muted-foreground">
                  {t("Query returned no rows.")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * One column header: the name, its place in the sort, and the menu of the
 * directions it can be put in.
 *
 * The arrow beside the name is the fast path — clicking it walks the column
 * through ascending, descending, off — and the chevron is the slow one, for
 * when the user wants to name the direction rather than cycle to it.
 */
function GridHeaderCell({
  column,
  sort,
  onSortChange
}: {
  column: string;
  sort: ColumnSort[];
  onSortChange: (sort: ColumnSort[]) => void;
}) {
  const t = useT();
  const sortAt = sortIndexOf(sort, column);
  const entry = sortAt >= 0 ? sort[sortAt] : undefined;
  const [open, setOpen] = useState(false);

  return (
    <th className="border-b border-r px-2 py-1 text-left font-medium">
      <span className="flex items-center gap-1">
        <span className="truncate">{column}</span>
        <button
          type="button"
          className={cn(
            "flex shrink-0 items-center gap-px rounded-sm px-0.5 text-[9px] font-semibold",
            entry ? "text-primary" : "text-muted-foreground/60 hover:text-foreground"
          )}
          aria-label={t("Sort by {column}", { column })}
          onClick={(event) => {
            // Shift keeps the other columns' places, which is how a
            // multi-column sort is built.
            onSortChange(cycleSort(sort, column, event.shiftKey));
          }}
        >
          {entry?.desc ? "ZA" : "AZ"}
          {sort.length > 1 && entry ? <span>{sortAt + 1}</span> : null}
        </button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("Column actions for {column}", { column })}
            >
              <ChevronDown className="size-2.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1 text-[11px]">
            <MenuButton
              label={t("Sort ascending")}
              onClick={() => {
                onSortChange(setSortDirection(sort, column, false));
                setOpen(false);
              }}
            />
            <MenuButton
              label={t("Sort descending")}
              onClick={() => {
                onSortChange(setSortDirection(sort, column, true));
                setOpen(false);
              }}
            />
            {entry ? (
              <MenuButton
                label={t("Clear sort")}
                onClick={() => {
                  onSortChange(sort.filter((s) => s.column !== column));
                  setOpen(false);
                }}
              />
            ) : null}
          </PopoverContent>
        </Popover>
      </span>
    </th>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/**
 * One cell.
 *
 * `title` carries the untruncated text: the column is capped so a single long
 * value cannot push every other column off screen, and capping it without a
 * way to read the rest would just be losing data quietly.
 */
function GridCell({ value }: { value: unknown }) {
  const { text, kind } = formatCell(value);
  return (
    <td title={text} className={cn("max-w-xs truncate border-r px-2 py-1 font-mono", cellClass(kind))}>
      {text}
    </td>
  );
}
