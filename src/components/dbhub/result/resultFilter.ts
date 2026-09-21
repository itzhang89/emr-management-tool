import type { CellFilter, ColumnSort, FilterOperator } from "@/services/dbWorkspaceCache";
import { cellText, compareValues, sortRows, type Row } from "./resultGridModel";

/**
 * Narrowing a loaded page to the rows a value in it satisfies.
 *
 * Client-side and page-local, like the sort: the filter decides which of the
 * rows already in hand get drawn, and never goes back to the server. The footer
 * keeps counting the page, because that is what the page is — so the count of
 * what survived the filter is stated by the filter bar instead, next to the
 * conditions themselves. A filter that quietly made a count mean something else
 * would be worse than no filter.
 *
 * The comparisons are the grid's own, borrowed from the sort rather than
 * written again here — see `compareValues`. Two answers to "is this value
 * greater than that one" inside one result would eventually disagree, and the
 * row that landed on the wrong side of the line would have nothing to explain
 * itself.
 */

/** The five by-value filters, in the order the menu offers them. */
const OPERATOR_ORDER: readonly FilterOperator[] = ["eq", "ne", "gt", "lt", "like"];

/** A cell with nothing in it — the one thing every comparison below asks first. */
function isNull(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Which operators mean anything for the value in hand.
 *
 * All five for a value that is there. For a NULL, only the two that ask whether
 * it is missing: it has no magnitude to be greater or less than, and nothing to
 * contain anything, so those three items would be offering to compare against
 * no value at all. Hiding them is what keeps every item in the menu a question
 * with an answer.
 */
export function operatorsFor(value: unknown): FilterOperator[] {
  return isNull(value) ? ["eq", "ne"] : [...OPERATOR_ORDER];
}

/** How SQL escapes a wildcard that is meant to stand for itself. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * A cell's text as the pattern that contains it.
 *
 * The menu says "rows like this one", which is a *containment* — and the value
 * it was asked about is a value, not a pattern: a `%` in the cell is a percent
 * sign, and looking for it must not turn into looking for anything. Escaping it
 * is what makes the two ideas one: `%50\%%` is SQL for "contains 50%", and it
 * is also exactly the text the chip shows, so the expression a click writes
 * into the filter box means what the click meant when it is read back.
 */
export function likePattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

/** One character, escaped so it stands for itself inside a regular expression. */
function literal(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A `LIKE` pattern as the regular expression it stands for.
 *
 * `%` for any run of characters and `_` for exactly one, with a backslash
 * escaping either — the three rules SQL defines, and the reason this is not
 * `String.includes`: a typed expression is SQL, so `name LIKE 'ab%'` has to
 * mean "starts with ab" rather than "contains the characters ab%".
 *
 * Case-insensitive, like every other comparison here: `compareValues` reads
 * `UTC` and `utc` as one value, and a `LIKE` that disagreed would be the same
 * kind of contradiction the shared comparator exists to prevent.
 */
export function compileLike(pattern: string): RegExp {
  let source = "";
  for (let at = 0; at < pattern.length; at += 1) {
    const character = pattern[at]!;
    const next = pattern[at + 1];
    if (character === "\\" && next !== undefined) {
      source += literal(next);
      at += 1;
      continue;
    }
    if (character === "%") source += ".*";
    else if (character === "_") source += ".";
    else source += literal(character);
  }
  return new RegExp(`^${source}$`, "i");
}

/** The condition a menu choice means, built from the cell that was right-clicked. */
export function filterFor(column: string, operator: FilterOperator, value: unknown): CellFilter {
  const text = cellText(value);
  return {
    column,
    operator,
    // A contains is written as the pattern that means it, so a condition made
    // by clicking and one typed into the box are the same kind of thing — see
    // `likePattern`.
    value: operator === "like" ? likePattern(text) : text,
    isNull: isNull(value)
  };
}

/**
 * The expression a condition stands for — what its menu item says and what its
 * chip says.
 *
 * Written as the predicate it is rather than paraphrased, because a person who
 * knows SQL reads it in one glance and can paste it into a query to check the
 * same thing server-side. Quoted the way SQL quotes, so a value with an
 * apostrophe in it still spells a literal rather than ending one.
 */
export function filterLabel(filter: CellFilter): string {
  const { column, operator, value, isNull } = filter;
  if (isNull) return `${column} ${operator === "eq" ? "IS NULL" : "IS NOT NULL"}`;
  const literal = `'${value.replace(/'/g, "''")}'`;
  if (operator === "eq") return `${column} = ${literal}`;
  if (operator === "ne") return `${column} <> ${literal}`;
  if (operator === "gt") return `${column} > ${literal}`;
  if (operator === "lt") return `${column} < ${literal}`;
  // Nothing wrapped around it: a `like` value is already the pattern — the
  // menu writes `%value%` and a typed expression brings its own wildcards.
  return `${column} LIKE ${literal}`;
}

/**
 * Whether one cell answers one condition.
 *
 * Two of the five carry a decision worth stating.
 *
 * "Not equal" is the plain complement of "equal", NULLs included. SQL would
 * leave a null out of `= 'x'` *and* out of `<> 'x'`, so a table that is all
 * nulls answers "nothing matches" to both — true to the standard, and useless
 * to somebody looking at the rows. This filter is a question about rows already
 * in hand, not a predicate being pushed to a server, so it answers.
 *
 * The other three need a value to compare, and a NULL is not greater than the
 * filter's value, less than it, or like it. Never matching is what those
 * columns are.
 */
function matches(value: unknown, filter: CellFilter): boolean {
  const missing = isNull(value);
  if (filter.operator === "eq") {
    return filter.isNull ? missing : !missing && compareValues(value, filter.value) === 0;
  }
  if (filter.operator === "ne") {
    return filter.isNull ? !missing : missing || compareValues(value, filter.value) !== 0;
  }
  if (missing) return false;
  if (filter.operator === "like") return compileLike(filter.value).test(cellText(value));
  const order = compareValues(value, filter.value);
  if (filter.operator === "gt") return order > 0;
  return order < 0;
}

/** Whether a row survives every condition. The list is read as ANDs. */
export function rowMatches(row: Row, filters: CellFilter[]): boolean {
  return filters.every((filter) => matches(row[filter.column], filter));
}

export function filterRows(rows: Row[], filters: CellFilter[]): Row[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => rowMatches(row, filters));
}

/**
 * A condition's identity, for telling one apart from another.
 *
 * The `isNull` flag is part of it rather than folded into the value: `IS NULL`
 * and `= 'NULL'` are different conditions, and a bar holding both would be
 * right to. Serialised rather than joined by a separator, because a column
 * named `a eq 0 b` must not be able to spell another condition's key.
 *
 * A null condition's value is left out, because nothing reads it: the menu
 * spells the value of a null cell as the text `NULL`, a typed expression leaves
 * it empty, and a key that told those two apart would call one condition two.
 */
function filterKey(filter: CellFilter): string {
  const value = filter.isNull ? "" : filter.value;
  return JSON.stringify([filter.column, filter.operator, filter.isNull, value]);
}

/**
 * Add a condition to the list, unless it is already there.
 *
 * Choosing the same menu item twice asks one question twice, and the second
 * answer is the first one — so it is not a second condition, and a bar with two
 * identical chips would be claiming a narrowing that is not happening.
 * Conditions on *different* values of one column do stack, and that is the
 * point: both chips are shown, and each says which one it is.
 */
export function addFilter(filters: CellFilter[], filter: CellFilter): CellFilter[] {
  const key = filterKey(filter);
  return filters.some((entry) => filterKey(entry) === key) ? filters : [...filters, filter];
}

/**
 * The conditions as the text that would ask for them again — what the filter
 * box holds after one of its chips is taken off.
 *
 * The box is where conditions live, so removing one is an edit to that text
 * rather than a second place the filter is kept. Written from the labels, which
 * are already the spelling SQL uses, so what comes out is what went in.
 */
export function expressionFor(filters: CellFilter[]): string {
  return filters.map(filterLabel).join(" AND ");
}

/**
 * The rows a result is showing, in the order it is showing them.
 *
 * Sorting rearranges and filtering selects, in that order — the same two steps
 * the pane takes to lay the grid out, so what is exported is the view rather
 * than a second opinion about it. A file that carried rows the user had
 * filtered away would be the loudest version of the silent surprise this whole
 * feature is written to avoid.
 */
export function orderedRows(rows: Row[], sort: ColumnSort[], filters: CellFilter[]): Row[] {
  return filterRows(sortRows(rows, sort), filters);
}
