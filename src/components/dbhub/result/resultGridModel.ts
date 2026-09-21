import type { ColumnSort } from "@/services/dbWorkspaceCache";

/**
 * The arithmetic behind the result grid, kept out of the component so it can
 * be reasoned about — and tested — without rendering a table.
 *
 * Everything here works on one loaded page. Paging re-runs the statement on
 * the server, so the grid never has more rows than the page it was handed, and
 * sorting them is a client-side affair over that fixed set. The one thing that
 * reaches past it is the row count, and that is deliberately something the
 * user asks for rather than something the grid assumes.
 */

export type CellKind = "null" | "number" | "boolean" | "text" | "json";

export interface FormattedCell {
  text: string;
  kind: CellKind;
}

/**
 * A cell as the grid shows it.
 *
 * `null` and the *string* `"NULL"` used to render identically, which made a
 * missing value indistinguishable from four letters somebody stored on
 * purpose. The kind is what separates them: the grid styles a true null as a
 * muted placeholder, so the distinction is visible without having to trust the
 * text.
 */
export function formatCell(value: unknown): FormattedCell {
  if (value === null || value === undefined) return { text: "NULL", kind: "null" };
  if (typeof value === "number") return { text: String(value), kind: "number" };
  if (typeof value === "boolean") return { text: value ? "true" : "false", kind: "boolean" };
  if (typeof value === "object") {
    try {
      return { text: JSON.stringify(value), kind: "json" };
    } catch {
      // A cyclic or otherwise unserialisable value still has to be drawn.
      return { text: String(value), kind: "json" };
    }
  }
  return { text: String(value), kind: "text" };
}

/** The raw text of a cell, for copying and for the text view. */
export function cellText(value: unknown): string {
  const { text } = formatCell(value);
  return text;
}

/**
 * How a value of each kind is drawn.
 *
 * Here rather than inside either renderer because two of them draw cells now —
 * the grid and the record panel below it — and two copies of these rules would
 * drift, with the drift showing up as the same value styled two ways inside one
 * result. Sizing stays with each renderer: a grid cell is truncated to a column
 * width, a record panel's is not.
 */
export function cellClass(kind: CellKind): string {
  if (kind === "number") return "text-right tabular-nums";
  if (kind === "null") return "italic text-muted-foreground/70";
  if (kind === "boolean") return "text-violet-600 dark:text-violet-400";
  if (kind === "json") return "text-sky-700 dark:text-sky-400";
  return "";
}

/**
 * Settle a pair where one or both sides are missing, before any direction is
 * applied: `undefined` when neither is, and 1/-1 when exactly one is — always
 * aiming the missing one last.
 *
 * This is separate from `compareValues` because "last" is a property of the
 * null, not of the sort. Folding it into one comparator and negating the whole
 * result for a descending sort flipped nulls to the *top* — the opposite of
 * what a missing value is supposed to do.
 */
function compareNulls(a: unknown, b: unknown): number | undefined {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (!aNull && !bNull) return undefined;
  if (aNull && bNull) return 0;
  return aNull ? 1 : -1;
}

/**
 * Order two cells that are both present.
 *
 * Shared with the filter, which is why it is exported: "is this value greater
 * than that one" is one question, and a filter answering it differently from
 * the sort would put a row on the wrong side of the line the user drew. The
 * same goes for equality — `compareValues(a, b) === 0` is what "the same value"
 * means here, so `100` matches `100.0` and `UTC` matches `utc`.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);

  // Numbers that arrived as strings — which is how every engine hands back a
  // DECIMAL — should still sort by magnitude, not by digit.
  const aNumber = typeof a === "string" && a.trim() !== "" ? Number(a) : NaN;
  const bNumber = typeof b === "string" && b.trim() !== "" ? Number(b) : NaN;
  if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) return aNumber - bNumber;

  const aText = typeof a === "object" ? JSON.stringify(a) : String(a);
  const bText = typeof b === "object" ? JSON.stringify(b) : String(b);
  return aText.localeCompare(bText, undefined, { numeric: true, sensitivity: "base" });
}

export type Row = Record<string, unknown>;

/**
 * A row paired with its place on the page it arrived in.
 *
 * Sorting rearranges the view of the page; it does not renumber the rows in
 * it. Keeping the two together is what lets a sorted grid draw 7, 2, 9 down
 * the number column and still highlight the row the record panel is counting
 * to — both of them are talking about the same place in the same page.
 */
export interface IndexedRow {
  row: Row;
  /** Zero-based position in the page as the server sent it. */
  index: number;
}

/**
 * Apply the sort order. The array is the priority list — the first column
 * breaks ties for the second, and so on — which is what the header's own
 * priority badges show. Missing values sort last in both directions: a null is
 * not "smaller than everything", and burying it under a descending sort would
 * hide exactly the rows a data engineer is usually looking for.
 */
export function sortRows(rows: Row[], sort: ColumnSort[]): Row[] {
  if (sort.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const { column, desc } of sort) {
      const left = a[column];
      const right = b[column];
      // Nulls are settled first, so the direction below never reaches them.
      const nulls = compareNulls(left, right);
      if (nulls !== undefined) {
        if (nulls !== 0) return nulls;
        continue;
      }
      const order = compareValues(left, right);
      if (order !== 0) return desc ? -order : order;
    }
    return 0;
  });
}

/** Where a column sits in the sort order, or -1 when it is not sorting. */
export function sortIndexOf(sort: ColumnSort[], column: string): number {
  return sort.findIndex((entry) => entry.column === column);
}

/**
 * Clicking a header walks it through: unsorted → ascending → descending →
 * unsorted. Other columns keep their places, so a multi-column sort survives
 * until the user clears it.
 */
export function cycleSort(sort: ColumnSort[], column: string, additive: boolean): ColumnSort[] {
  const at = sortIndexOf(sort, column);
  if (at < 0) return additive ? [...sort, { column, desc: false }] : [{ column, desc: false }];
  const current = sort[at];
  if (!current) return sort;
  if (!current.desc) {
    const next = [...sort];
    next[at] = { column, desc: true };
    return next;
  }
  return sort.filter((entry) => entry.column !== column);
}

/**
 * Put a column into a given direction, keeping the place it already holds in
 * the priority list. Appending would silently demote the column the user just
 * asked to sort by, whenever it happened to be sorted already.
 */
export function setSortDirection(sort: ColumnSort[], column: string, desc: boolean): ColumnSort[] {
  const at = sortIndexOf(sort, column);
  if (at < 0) return [...sort, { column, desc }];
  const next = [...sort];
  next[at] = { column, desc };
  return next;
}

/**
 * The page as tab-separated text — what the text view shows and what "copy
 * all" puts on the clipboard.
 *
 * Values are quoted only when they would otherwise break the shape: a tab, a
 * newline, or a quote inside the value itself. Quoting everything would make
 * the common case unreadable for the sake of the rare one.
 */
export function toTsv(columns: string[], rows: Row[]): string {
  const escape = (value: string) =>
    /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [columns.map(escape).join("\t")];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(cellText(row[column]))).join("\t"));
  }
  return lines.join("\n");
}

/**
 * One record as tab-separated text: a field name and its value per line.
 *
 * The pair, not just the value. A single record copied on its own carries no
 * header row, so the values would arrive with nothing to say which column each
 * came from — the labels are what the panel puts down the left, and they are
 * what makes the copy readable away from the grid. A tab between the two, so
 * the paste lands in a spreadsheet as two columns rather than one line of
 * prose.
 *
 * Unquoted, unlike `toTsv`: a record is read and pasted by a person, and the
 * one thing it cannot do is break the shape of a table it is not being pasted
 * into.
 */
export function recordText(columns: string[], row?: Row): string {
  return columns.map((column) => `${column}\t${cellText(row?.[column])}`).join("\n");
}
