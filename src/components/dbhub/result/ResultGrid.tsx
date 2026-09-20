import { useCallback, useMemo, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ColumnSort } from "@/services/dbWorkspaceCache";
import {
  allGroupKeys,
  cycleSort,
  flattenGroups,
  formatCell,
  groupLabel,
  sortIndexOf,
  sortRows,
  setSortDirection,
  buildGroupTree,
  type GridLine,
  type Row
} from "./resultGridModel";

/**
 * The grid itself: the columns, their headers, and whatever the rows are doing
 * — sorted, grouped into a foldable tree, or neither.
 *
 * Three things are worth knowing before reading it.
 *
 * *The page is the world.* Sorting and grouping are client-side over the rows
 * the server sent, not over the table. The grid says so where it matters (the
 * text view copies what is loaded, the footer counts what is loaded) rather
 * than letting the user believe a sort reordered a table they cannot see.
 *
 * *Dragging is native.* HTML5 drag-and-drop, no library: a header carries its
 * column name on the drag, and the strip above the headers takes the drop.
 * `draggingColumn` is a module-level fallback because WebKit — which is what
 * Tauri renders in on macOS — refuses `getData` outside a `drop` handler, and
 * the strip needs to know a drag is in flight while it is being dragged over.
 *
 * *Nulls are drawn, not spelled.* `null` and the string `"NULL"` read the same
 * as text; the kind from `formatCell` is what keeps them apart on screen.
 */

/** What a header drag carries, and the fallback WebKit needs us to keep. */
const COLUMN_DRAG_TYPE = "application/x-dbhub-column";
let draggingColumn: string | undefined;

export function ResultGrid({
  columns,
  rows,
  offset,
  sort,
  onSortChange,
  groupBy,
  onGroupByChange,
  collapsed,
  onCollapsedChange,
  selectedIndex,
  onSelectRow
}: {
  columns: string[];
  rows: Row[];
  /** Where this page starts in the whole result, for the row numbers. */
  offset: number;
  sort: ColumnSort[];
  onSortChange: (sort: ColumnSort[]) => void;
  groupBy: string[];
  onGroupByChange: (groupBy: string[]) => void;
  collapsed: Set<string>;
  onCollapsedChange: (collapsed: Set<string>) => void;
  selectedIndex?: number;
  onSelectRow: (index: number) => void;
}) {
  const t = useT();
  const [dropActive, setDropActive] = useState(false);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  /** A row's place on the page — its identity through sorting and folding. */
  const indexOfRow = useCallback(
    (row: Row) => rows.indexOf(row),
    [rows]
  );

  const tree = useMemo(
    () => (groupBy.length > 0 ? buildGroupTree(sorted, groupBy) : []),
    [sorted, groupBy]
  );

  const lines: GridLine[] = useMemo(
    () =>
      groupBy.length > 0
        ? flattenGroups(tree, collapsed, indexOfRow)
        : sorted.map((row) => ({
            kind: "row" as const,
            row,
            index: indexOfRow(row),
            depth: 0
          })),
    [groupBy.length, tree, collapsed, sorted, indexOfRow]
  );

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    const column =
      event.dataTransfer.getData(COLUMN_DRAG_TYPE) ||
      event.dataTransfer.getData("text/plain") ||
      draggingColumn;
    draggingColumn = undefined;
    if (!column || !columns.includes(column)) return;
    if (groupBy.includes(column)) return;
    onGroupByChange([...groupBy, column]);
  };

  const allCollapsed = tree.length > 0 && allGroupKeys(tree).every((key) => collapsed.has(key));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <GroupStrip
        groupBy={groupBy}
        active={dropActive}
        onGroupByChange={onGroupByChange}
        onDragOver={(event) => {
          event.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
        onToggleAll={() => {
          // One button, two states: everything folded, or everything open.
          onCollapsedChange(allCollapsed ? new Set() : new Set(allGroupKeys(tree)));
        }}
        canToggleAll={tree.length > 0}
        allCollapsed={allCollapsed}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-[10px]">
          <thead className="sticky top-0 z-10 bg-muted/80">
            <tr>
              {/* The row-number column is the grid's own, so it has no name to
                  drag and nothing to sort by. */}
              <th className="w-px border-b border-r px-2 py-1 text-right font-medium text-muted-foreground">
                #
              </th>
              {columns.map((column) => (
                <GridHeaderCell
                  key={column}
                  column={column}
                  sort={sort}
                  grouped={groupBy.includes(column)}
                  onSortChange={onSortChange}
                  onGroupByChange={onGroupByChange}
                  groupBy={groupBy}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, position) =>
              line.kind === "group" ? (
                <GroupHeaderRow
                  key={`g:${line.node.key}`}
                  line={line}
                  columns={columns}
                  onToggle={() => {
                    const next = new Set(collapsed);
                    if (next.has(line.node.key)) next.delete(line.node.key);
                    else next.add(line.node.key);
                    onCollapsedChange(next);
                  }}
                />
              ) : (
                <tr
                  key={`r:${line.index}:${position}`}
                  className={cn(
                    "cursor-default border-b hover:bg-muted/40",
                    selectedIndex === line.index && "bg-primary/10"
                  )}
                  onClick={() => onSelectRow(line.index)}
                >
                  <td className="border-r px-2 py-1 text-right text-muted-foreground tabular-nums">
                    {offset + line.index + 1}
                  </td>
                  {columns.map((column, columnIndex) => (
                    <GridCell
                      key={column}
                      value={line.row[column]}
                      // Only the first column takes the group indent — the
                      // rest stay on their own gridlines so the columns still
                      // line up down the page.
                      indent={columnIndex === 0 ? line.depth : 0}
                    />
                  ))}
                </tr>
              )
            )}
            {lines.length === 0 ? (
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
 * The strip a column is dragged into.
 *
 * It is always drawn, even when empty: a drop target that only appears once a
 * drag is in flight is a target nobody discovers. Empty, it reads as the
 * instruction for how to fill it.
 */
function GroupStrip({
  groupBy,
  active,
  canToggleAll,
  allCollapsed,
  onGroupByChange,
  onToggleAll,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  groupBy: string[];
  active: boolean;
  canToggleAll: boolean;
  allCollapsed: boolean;
  onGroupByChange: (groupBy: string[]) => void;
  onToggleAll: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  const t = useT();

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "flex min-h-7 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1 text-[10px] transition-colors",
        active ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "bg-muted/20"
      )}
    >
      {groupBy.length === 0 ? (
        <span className="text-muted-foreground">
          {active ? t("Drop to group by this column") : t("Drag a column header here to group rows")}
        </span>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5 shrink-0"
            aria-label={t(allCollapsed ? "Expand all groups" : "Collapse all groups")}
            onClick={onToggleAll}
            disabled={!canToggleAll}
          >
            {allCollapsed ? (
              <ChevronsUpDown className="size-3" />
            ) : (
              <ChevronsDownUp className="size-3" />
            )}
          </Button>
          {groupBy.map((column, position) => (
            <span
              key={column}
              className="flex items-center gap-0.5 rounded-sm border bg-background px-1 py-0.5"
            >
              {/* Position matters: the first is the outermost group. */}
              <span className="text-muted-foreground tabular-nums">{position + 1}</span>
              <span className="font-medium">{column}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("Remove {column} from grouping", { column })}
                onClick={() => onGroupByChange(groupBy.filter((entry) => entry !== column))}
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * One column header: the name, its place in the sort, and the two things a
 * drag can do with it.
 *
 * The chevron opens the same actions a drag can reach, because dragging is not
 * a thing every user tries and grouping should not be gated behind discovering
 * it.
 */
function GridHeaderCell({
  column,
  sort,
  grouped,
  groupBy,
  onSortChange,
  onGroupByChange
}: {
  column: string;
  sort: ColumnSort[];
  grouped: boolean;
  groupBy: string[];
  onSortChange: (sort: ColumnSort[]) => void;
  onGroupByChange: (groupBy: string[]) => void;
}) {
  const t = useT();
  const sortAt = sortIndexOf(sort, column);
  const entry = sortAt >= 0 ? sort[sortAt] : undefined;
  const [open, setOpen] = useState(false);

  return (
    <th
      // The whole header is the drag handle — a grip icon would cost the width
      // of a column name to say something the cursor already says.
      draggable
      onDragStart={(event) => {
        draggingColumn = column;
        event.dataTransfer.setData(COLUMN_DRAG_TYPE, column);
        // WebKit ignores unknown types on drop, so plain text carries it too.
        event.dataTransfer.setData("text/plain", column);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onDragEnd={() => {
        draggingColumn = undefined;
      }}
      className={cn(
        "cursor-grab border-b border-r px-2 py-1 text-left font-medium select-none",
        grouped && "bg-primary/10"
      )}
      title={t("Drag to group · click the arrow to sort")}
    >
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
            <MenuButton
              label={grouped ? t("Remove from grouping") : t("Group by this column")}
              onClick={() => {
                onGroupByChange(
                  grouped
                    ? groupBy.filter((entry) => entry !== column)
                    : [...groupBy, column]
                );
                setOpen(false);
              }}
            />
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
 * A group's header row: the fold control, the value every row beneath shares,
 * and how many rows that is.
 *
 * The count is on the header rather than only in a footer because a folded
 * group is exactly the case where the user cannot see the rows to count them.
 */
function GroupHeaderRow({
  line,
  columns,
  onToggle
}: {
  line: Extract<GridLine, { kind: "group" }>;
  columns: string[];
  onToggle: () => void;
}) {
  const t = useT();
  const { node, collapsed } = line;
  const columnAt = columns.indexOf(node.column);

  return (
    <tr className="border-b bg-secondary/40 font-medium">
      <td className="border-r px-2 py-1" />
      {columns.map((column, columnIndex) => (
        <td key={column} className="px-2 py-1">
          {/* The fold control sits on the grouped column, so the indent says
              which level is being folded. */}
          {columnIndex === columnAt ? (
            <button
              type="button"
              className="flex items-center gap-1 text-left"
              style={{ paddingLeft: node.depth * 12 }}
              aria-expanded={!collapsed}
              onClick={onToggle}
            >
              {collapsed ? (
                <ChevronRight className="size-3 shrink-0" />
              ) : (
                <ChevronDown className="size-3 shrink-0" />
              )}
              <span className="truncate">
                {column}: {groupLabel(node.value)}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {t(node.count === 1 ? "{count} row" : "{count} rows", { count: node.count })}
              </span>
            </button>
          ) : null}
        </td>
      ))}
    </tr>
  );
}

/**
 * One cell.
 *
 * `title` carries the untruncated text: the column is capped so a single long
 * value cannot push every other column off screen, and capping it without a
 * way to read the rest would just be losing data quietly.
 */
function GridCell({ value, indent }: { value: unknown; indent: number }) {
  const { text, kind } = formatCell(value);
  return (
    <td
      title={text}
      style={indent > 0 ? { paddingLeft: indent * 12 + 8 } : undefined}
      className={cn(
        "max-w-xs truncate border-r px-2 py-1 font-mono",
        // Numbers line up only when they are right-aligned and tabular.
        kind === "number" && "text-right tabular-nums",
        kind === "null" && "italic text-muted-foreground/70",
        kind === "boolean" && "text-violet-600 dark:text-violet-400",
        kind === "json" && "text-sky-700 dark:text-sky-400"
      )}
    >
      {text}
    </td>
  );
}
