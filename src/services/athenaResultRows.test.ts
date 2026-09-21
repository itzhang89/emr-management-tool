import { describe, expect, it } from "vitest";
import {
  athenaRowsToRecords,
  isHeaderRow,
  mergeResultPages,
  uniqueColumnNames,
  withoutHeaderRow
} from "./athenaResultRows";
import type { AthenaQueryResults } from "@/types/domain";

/**
 * The seam between Athena's positional rows and the pane's named ones.
 *
 * It is worth testing on its own because its failures are quiet: a header row
 * left in draws as data, and a column name repeated draws the wrong column's
 * values under the second heading rather than erroring.
 */

function page(columnNames: string[], rows: string[][], nextToken?: string): AthenaQueryResults {
  return { columnNames, rows, nextToken };
}

describe("isHeaderRow", () => {
  it("recognises Athena's repeated header", () => {
    expect(isHeaderRow(["id", "name"], ["id", "name"])).toBe(true);
  });

  it("keeps a data row that merely resembles one", () => {
    // Same shape, different text — a table whose first row lists column names
    // is data, and dropping it would lose a row without saying so.
    expect(isHeaderRow(["id", "name"], ["1", "name"])).toBe(false);
    expect(isHeaderRow(["id", "name"], ["id", "Name"])).toBe(false);
    // Right values, wrong width: not this table's header.
    expect(isHeaderRow(["id", "name"], ["id", "name", "extra"])).toBe(false);
  });
});

describe("withoutHeaderRow", () => {
  it("drops the header and leaves the data", () => {
    const stripped = withoutHeaderRow(page(["id", "name"], [["id", "name"], ["1", "ada"]]));
    expect(stripped.rows).toEqual([["1", "ada"]]);
  });

  it("keeps a page that is nothing but a header, token and all", () => {
    // Every page repeats the header, so one can easily arrive with no rows of
    // its own — and it is still a page with more behind it.
    const stripped = withoutHeaderRow(page(["id"], [["id"]], "tok-2"));
    expect(stripped.rows).toEqual([]);
    expect(stripped.nextToken).toBe("tok-2");
  });

  it("passes a page with no rows straight through", () => {
    const empty = page(["id"], []);
    expect(withoutHeaderRow(empty)).toBe(empty);
  });
});

describe("mergeResultPages", () => {
  it("replaces when not appending, and appends when it is", () => {
    const first = page(["id"], [["1"]], "tok-2");
    const second = page([], [["2"]], "tok-3");

    expect(mergeResultPages(first, second, false)).toEqual(second);
    // A later page names no columns, so the ones already in hand survive it.
    expect(mergeResultPages(first, second, true)).toEqual({
      columnNames: ["id"],
      rows: [["1"], ["2"]],
      nextToken: "tok-3"
    });
  });

  it("takes the first page as-is when nothing is in hand yet", () => {
    const first = page(["id"], [["1"]]);
    expect(mergeResultPages(undefined, first, true)).toEqual(first);
  });
});

describe("uniqueColumnNames", () => {
  it("leaves distinct names alone", () => {
    expect(uniqueColumnNames(["id", "name"])).toEqual(["id", "name"]);
  });

  it("bumps a repeated name past one already taken", () => {
    // `a, a_2, a` must not produce two `a_2`s: the third column would be lost.
    expect(uniqueColumnNames(["a", "a_2", "a"])).toEqual(["a", "a_2", "a_3"]);
  });

  it("names every repeat of a name repeated many times", () => {
    expect(uniqueColumnNames(["sales", "sales", "sales"])).toEqual(["sales", "sales_2", "sales_3"]);
  });
});

describe("athenaRowsToRecords", () => {
  it("keys each cell by its column's name", () => {
    const { columns, rows } = athenaRowsToRecords(
      page(["id", "name"], [["1", "ada"], ["2", "grace"]])
    );
    expect(columns).toEqual(["id", "name"]);
    expect(rows).toEqual([
      { id: "1", name: "ada" },
      { id: "2", name: "grace" }
    ]);
  });

  it("gives a repeated column its own key rather than overwriting the first", () => {
    const { columns, rows } = athenaRowsToRecords(page(["sales", "sales"], [["1", "2"]]));
    expect(columns).toEqual(["sales", "sales_2"]);
    // The failure this guards against is silent: both would otherwise be `1`.
    expect(rows).toEqual([{ sales: "1", sales_2: "2" }]);
  });

  it("pads a short row with blanks rather than nulls", () => {
    // Athena sends NULL as "", so a blank is what it would have sent; a null
    // would draw as a NULL badge for a distinction the wire cannot carry.
    const { rows } = athenaRowsToRecords(page(["id", "name"], [["1"]]));
    expect(rows).toEqual([{ id: "1", name: "" }]);
  });

  it("has nothing to say about a result that never arrived", () => {
    expect(athenaRowsToRecords(undefined)).toEqual({ columns: [], rows: [] });
  });
});
