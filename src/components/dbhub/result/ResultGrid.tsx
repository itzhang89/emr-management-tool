import { useRef, useState } from "react";
import { ChevronDown, Copy, Filter } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CellFilter, ColumnSort } from "@/services/dbWorkspaceCache";
import {
  cellClass,
  cellText,
  cycleSort,
  formatCell,
  sortIndexOf,
  setSortDirection,
  type IndexedRow
} from "./resultGridModel";
import { filterFor, filterLabel, operatorsFor } from "./resultFilter";

/**
 * The grid itself: the columns, their headers, and the rows in the order the
 * sort put them.
 *
 * Three things are worth knowing before reading it.
 *
 * *The page is the world.* Sorting and filtering are client-side over the rows
 * the server sent, not over the table. The grid says so where it matters (the
 * text view copies what is loaded, the footer counts what is loaded) rather
 * than letting the user believe a sort reordered a table they cannot see.
 *
 * *Sorting rearranges the view, not the rows.* A row keeps the number it had
 * on the page, so a sorted grid can read 7, 2, 9 — and the number the record
 * panel counts by is the same one. That is why the rows arrive already paired
 * with their places rather than the grid numbering them top to bottom.
 *
 * *A filter is asked of a cell, not of a column.* The menu that opens on a
 * right-click is built around the value under the pointer, because that is the
 * question a person has when they right-click one: not "what can I do to this
 * column" — the header already answers that — but "show me the rows like this
 * one". So the value travels with the menu, and the conditions it makes are the
 * pane's to keep.
 */

/** The cell a right-click landed on: what the menu is about. */
interface CellTarget {
  column: string;
  value: unknown;
}

export function ResultGrid({
  columns,
  rows,
  offset,
  sort,
  onSortChange,
  filtered,
  onFilter,
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
  /** Whether a filter is what left the grid with nothing to draw. */
  filtered?: boolean;
  onFilter: (filter: CellFilter) => void;
  selectedIndex?: number;
  onSelectRow: (index: number) => void;
}) {
  const t = useT();
  // The cell under the last right-click. The menu reads it, and the ref is the
  // same answer for the one decision that cannot wait for a render — whether to
  // open at all.
  const targetRef = useRef<CellTarget | null>(null);
  const [target, setTarget] = useState<CellTarget | null>(null);
  const [open, setOpen] = useState(false);

  /**
   * Note which cell a right-click landed on, from the markup rather than from
   * per-cell handlers: a page is hundreds of cells, and one listener on the
   * scroll container that reads the two data attributes costs a `closest()`
   * per click instead of a component per cell.
   *
   * A right-click anywhere else — a header, the row-number column, the empty
   * space under the rows — lands on no cell, and the menu is told not to open:
   * every item in it would otherwise be acting on the cell before last, which
   * the user cannot even see is still selected.
   */
  const rememberCell = (event: React.MouseEvent) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-column]");
    const column = cell?.dataset.column;
    const place = cell?.closest<HTMLElement>("[data-row-index]")?.dataset.rowIndex;
    const row = place === undefined ? undefined : rows.find((entry) => entry.index === Number(place));
    const next = column !== undefined && row ? { column, value: row.row[column] } : null;
    targetRef.current = next;
    setTarget(next);
  };

  const copyCell = async () => {
    if (!target) return;
    try {
      await navigator.clipboard.writeText(cellText(target.value));
    } catch {
      toast.error("Could not copy the cell — the clipboard was refused.");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Controlled, so a right-click that landed on no cell can leave the menu
          shut. Radix decides to open from the same event that names the cell,
          so the veto reads the ref rather than the state it has not set yet. */}
      <ContextMenu open={open} onOpenChange={(next) => setOpen(next && targetRef.current !== null)}>
        <ContextMenuTrigger asChild>
          <div className="min-h-0 flex-1 overflow-auto" onContextMenu={rememberCell}>
            <table className="min-w-full border-collapse text-[10px]">
              <thead className="sticky top-0 z-10 bg-muted/80">
                <tr>
                  {/* The row-number column is the grid's own, so it has no name to
                      sort by. */}
                  <th className="w-px border-b border-r px-2 py-1 text-right font-medium text-muted-foreground">
                    #
                  </th>
                  {columns.map((column) => (
                    <GridHeaderCell
                      key={column}
                      column={column}
                      sort={sort}
                      onSortChange={onSortChange}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row, index }) => (
                  <tr
                    key={index}
                    data-row-index={index}
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
                      <GridCell key={column} column={column} value={row[column]} />
                    ))}
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="px-2 py-3 text-muted-foreground">
                      {t(
                        filtered
                          ? "No rows on this page match the filter."
                          : "Query returned no rows."
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="text-[11px]">
          <ContextMenuItem onSelect={() => void copyCell()}>
            <Copy className="size-3" />
            {t("Copy")}
          </ContextMenuItem>
          {target ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Filter className="size-3" />
                  {t("Filter")}
                </ContextMenuSubTrigger>
                {/* Built from the value in hand, so each item is a question that
                    has an answer — see `operatorsFor`. */}
                <ContextMenuSubContent className="min-w-52 font-mono text-[11px]">
                  {operatorsFor(target.value).map((operator) => {
                    const filter = filterFor(target.column, operator, target.value);
                    return (
                      <ContextMenuItem key={operator} onSelect={() => onFilter(filter)}>
                        {filterLabel(filter)}
                      </ContextMenuItem>
                    );
                  })}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
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
 *
 * `data-column` is how the context menu finds out which value it was opened on
 * — see `rememberCell`.
 */
function GridCell({ column, value }: { column: string; value: unknown }) {
  const { text, kind } = formatCell(value);
  return (
    <td
      data-column={column}
      title={text}
      className={cn("max-w-xs truncate border-r px-2 py-1 font-mono", cellClass(kind))}
    >
      {text}
    </td>
  );
}
