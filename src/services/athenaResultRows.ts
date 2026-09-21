import type { ResultRows } from "@/services/resultView";
import type { AthenaQueryResults } from "@/types/domain";

/**
 * Athena's rows, in the shape every result pane reads.
 *
 * `GetQueryResults` hands back positions, not names: `rows` is a `string[][]`
 * whose entries line up with `columnNames` by index. The shared pane — the
 * grid, the text view, the record panel, sorting, filtering, the right-click
 * menu — is built on `Record<string, unknown>` keyed by column name, because
 * that is what a sort order and a filter condition name. So this module is the
 * one place the two meet.
 *
 * The header is *not* dealt with here. Athena puts the column names in the
 * first row of every page, so a page arrives with one row more than it has
 * data; dropping it is the job of whoever fetches the page (see
 * `withoutHeaderRow`), because a page that has been merged into the ones before
 * it can no longer say which of its rows was its own header. This module only
 * maps and names, which keeps each of the two easy to check on its own.
 */

/**
 * Whether this row is the page's own header rather than data.
 *
 * Athena repeats the header at the top of every page, so this has to be asked
 * per page and not once over the accumulated set. The test is an exact match
 * against the column names — same length, same values in the same places —
 * because anything looser would eat a row that legitimately holds the same text
 * as the headings above it, which is exactly what a table of column names looks
 * like.
 */
export function isHeaderRow(columnNames: string[], row: string[]): boolean {
  return row.length === columnNames.length && row.every((value, index) => value === columnNames[index]);
}

/**
 * The page with its header row taken off, if it arrived with one.
 *
 * Everything else about the page is passed through untouched, `nextToken`
 * included: a page can be nothing but a header and still be a page with more
 * behind it.
 */
export function withoutHeaderRow(page: AthenaQueryResults): AthenaQueryResults {
  if (page.rows.length === 0) return page;
  const [first, ...rest] = page.rows;
  if (!first || !isHeaderRow(page.columnNames, first)) return page;
  return { ...page, rows: rest };
}

/**
 * One page of results, replacing what was there or appended to it.
 *
 * Replacing is what a refresh does, and appending is what "load more rows"
 * does; both come through here so that the columns of the pages already in hand
 * survive a page that arrived without any. Athena only names the columns on the
 * first page of a result, so a later page that dropped them would otherwise
 * blank the grid's headings.
 */
export function mergeResultPages(
  current: AthenaQueryResults | undefined,
  page: AthenaQueryResults,
  append: boolean
): AthenaQueryResults {
  if (!append || !current) {
    return page;
  }
  return {
    columnNames: page.columnNames.length ? page.columnNames : current.columnNames,
    rows: [...current.rows, ...page.rows],
    nextToken: page.nextToken
  };
}

/**
 * Names for the columns that are actually distinct.
 *
 * A repeated column name is not merely untidy here, it is wrong: the pane reads
 * a cell as `row[column]`, so a second column called `sales` would draw the
 * *first* column's values under its own heading, and nothing on screen would
 * say so. (A table can honestly hold two identically-named columns — a join of
 * a table with itself, or two `SELECT *`s.) So each repeat is given a suffix,
 * and the suffix is bumped until it is free, which is what keeps
 * `a, a_2, a` from producing a second `a_2` and losing the third column
 * instead.
 */
export function uniqueColumnNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    let suffix = 2;
    while (used.has(`${name}_${suffix}`)) suffix += 1;
    const unique = `${name}_${suffix}`;
    used.add(unique);
    return unique;
  });
}

/**
 * Athena's positional rows, keyed by column name.
 *
 * Cells are passed through as the strings Athena sent — `athena.rs` has already
 * flattened NULL to `""` and thrown the column types away, so a cell is text
 * here whatever it held in the table, and nothing is styled as a number or a
 * boolean. A row with fewer cells than there are columns gets empty strings
 * rather than nulls, for the same reason: a blank cell is what Athena itself
 * would have sent, and a NULL badge would be inventing a distinction this side
 * of the wire cannot make.
 */
export function athenaRowsToRecords(results?: AthenaQueryResults): ResultRows {
  if (!results) return { columns: [], rows: [] };
  const columns = uniqueColumnNames(results.columnNames);
  const rows = results.rows.map((cells) => {
    const record: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      record[column] = cells[index] ?? "";
    });
    return record;
  });
  return { columns, rows };
}
