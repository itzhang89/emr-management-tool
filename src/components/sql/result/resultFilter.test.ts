import { describe, expect, it } from "vitest";
import type { CellFilter } from "@/services/resultView";
import {
  addFilter,
  expressionFor,
  filterFor,
  filterLabel,
  filterRows,
  operatorsFor,
  orderedRows
} from "./resultFilter";
import { parseFilter } from "./resultFilterParse";
import type { Row } from "./resultGridModel";

function rows(...values: Array<Record<string, unknown>>): Row[] {
  return values;
}

/** The condition a right-click on a cell with this value would make. */
function pick(column: string, operator: CellFilter["operator"], value: unknown): CellFilter {
  return filterFor(column, operator, value);
}

describe("filterLabel", () => {
  it("spells the predicate the menu item stands for", () => {
    expect(filterLabel(pick("time_zone", "eq", "UTC"))).toBe("time_zone = 'UTC'");
    expect(filterLabel(pick("time_zone", "ne", "UTC"))).toBe("time_zone <> 'UTC'");
    expect(filterLabel(pick("time_zone", "gt", "UTC"))).toBe("time_zone > 'UTC'");
    expect(filterLabel(pick("time_zone", "lt", "UTC"))).toBe("time_zone < 'UTC'");
    expect(filterLabel(pick("time_zone", "like", "UTC"))).toBe("time_zone LIKE '%UTC%'");
  });

  it("asks about a missing value in the words for it", () => {
    // `= 'NULL'` would read as a comparison with four letters somebody stored,
    // which is the one thing this filter is careful not to mean.
    expect(filterLabel(pick("time_zone", "eq", null))).toBe("time_zone IS NULL");
    expect(filterLabel(pick("time_zone", "ne", null))).toBe("time_zone IS NOT NULL");
  });

  it("quotes a value that has a quote in it", () => {
    // The label is read as the predicate it stands for, so it has to survive
    // being pasted into a query — o'brien must not end the literal early.
    expect(filterLabel(pick("name", "eq", "o'brien"))).toBe("name = 'o''brien'");
  });
});

describe("operatorsFor", () => {
  it("offers all five for a value that is there", () => {
    expect(operatorsFor("UTC")).toEqual(["eq", "ne", "gt", "lt", "like"]);
    // Zero and the empty string are values, not the absence of one.
    expect(operatorsFor(0)).toHaveLength(5);
    expect(operatorsFor("")).toHaveLength(5);
    expect(operatorsFor(false)).toHaveLength(5);
  });

  it("offers only the two that can be answered for a NULL", () => {
    // Nothing to be greater than, less than, or to contain.
    expect(operatorsFor(null)).toEqual(["eq", "ne"]);
    expect(operatorsFor(undefined)).toEqual(["eq", "ne"]);
  });
});

describe("filterRows", () => {
  it("keeps the rows a value is equal to", () => {
    const page = rows({ tz: "UTC" }, { tz: "CST" }, { tz: "UTC" });
    expect(filterRows(page, [pick("tz", "eq", "UTC")])).toHaveLength(2);
  });

  it("reads equality the way the sort reads order", () => {
    // Same comparator, so `100` and `100.0` are one value here for the same
    // reason they sit in one place there.
    const page = rows({ amount: 100 }, { amount: 100.5 });
    expect(filterRows(page, [pick("amount", "eq", 100)])).toHaveLength(1);
    expect(filterRows(rows({ amount: "100.0" }), [pick("amount", "eq", 100)])).toHaveLength(1);
    // Case is not a difference: the user clicked a value they can see.
    expect(filterRows(rows({ tz: "utc" }), [pick("tz", "eq", "UTC")])).toHaveLength(1);
  });

  it("orders by magnitude, not by digit", () => {
    const page = rows({ n: 9 }, { n: 10 }, { n: 100 });
    // Read as text, "9" is the largest of the three.
    expect(filterRows(page, [pick("n", "gt", 10)])).toEqual([{ n: 100 }]);
    expect(filterRows(page, [pick("n", "lt", 10)])).toEqual([{ n: 9 }]);
  });

  it("contains rather than matches a pattern", () => {
    const page = rows({ note: "re-run the job" }, { note: "100% done" }, { note: "aaa" });
    expect(filterRows(page, [pick("note", "like", "job")])).toEqual([{ note: "re-run the job" }]);
    // The `%` came out of a cell, so it is a percent sign and not a wildcard.
    expect(filterRows(page, [pick("note", "like", "100%")])).toEqual([{ note: "100% done" }]);
    expect(filterRows(page, [pick("note", "like", "%")])).toEqual([{ note: "100% done" }]);
  });

  it("answers `not equal` for the rows a null column has", () => {
    // The complement, rather than SQL's leave-it-out-of-both. Every row here
    // is either UTC or missing, so a `<>` that dropped the nulls would answer
    // "nothing matches" to a filter the user can see two rows for.
    const page = rows({ tz: "UTC" }, { tz: null }, {});
    expect(filterRows(page, [pick("tz", "ne", "UTC")])).toHaveLength(2);
  });

  it("matches a missing value only when that is what was asked for", () => {
    const page = rows({ tz: "UTC" }, { tz: null }, {});
    expect(filterRows(page, [pick("tz", "eq", null)])).toHaveLength(2);
    // And the four letters are not the missing value.
    expect(filterRows(rows({ tz: "NULL" }), [pick("tz", "eq", null)])).toHaveLength(0);
    expect(filterRows(rows({ tz: "NULL" }), [pick("tz", "eq", "NULL")])).toHaveLength(1);
  });

  it("never matches a missing value on the three that need one", () => {
    const page = rows({ tz: null }, { tz: "UTC" });
    expect(filterRows(page, [pick("tz", "gt", "")])).toEqual([{ tz: "UTC" }]);
    expect(filterRows(page, [pick("tz", "lt", "zzz")])).toEqual([{ tz: "UTC" }]);
    expect(filterRows(page, [pick("tz", "like", "U")])).toEqual([{ tz: "UTC" }]);
  });

  it("reads a typed LIKE as the pattern it is, wildcards and all", () => {
    // The other half of the bargain `likePattern` describes: a value that came
    // from a cell is a value, and a pattern that was typed is a pattern.
    const page = rows({ tz: "UTC-1" }, { tz: "x-utc" }, { tz: "CST" });
    const pattern = (value: string): CellFilter => ({
      column: "tz",
      operator: "like",
      value,
      isNull: false
    });
    expect(filterRows(page, [pattern("utc%")])).toEqual([{ tz: "UTC-1" }]);
    expect(filterRows(page, [pattern("%utc")])).toEqual([{ tz: "x-utc" }]);
    // One character, not any run of them.
    expect(filterRows(page, [pattern("c_t")])).toEqual([{ tz: "CST" }]);
    // And a backslash gets a wildcard out of the way, so the `%` is a percent
    // sign — the same escape the menu's own patterns are written with.
    expect(filterRows(rows({ tz: "50%" }), [pattern("%50\\%%")])).toEqual([{ tz: "50%" }]);
  });

  it("reads several conditions as ANDs", () => {
    const page = rows(
      { tz: "UTC", n: 1 },
      { tz: "UTC", n: 2 },
      { tz: "CST", n: 1 }
    );
    expect(filterRows(page, [pick("tz", "eq", "UTC"), pick("n", "gt", 1)])).toEqual([
      { tz: "UTC", n: 2 }
    ]);
    // Contradictory conditions are allowed to select nothing: both chips are on
    // screen, so the empty grid has an explanation.
    expect(filterRows(page, [pick("tz", "eq", "UTC"), pick("tz", "eq", "CST")])).toEqual([]);
  });

  it("hands back the page itself when nothing is filtered", () => {
    // Identity, not a copy: the pane rebuilds the row pairing from these
    // objects, and a fresh array every render would rebuild it every render.
    const page = rows({ tz: "UTC" });
    expect(filterRows(page, [])).toBe(page);
  });
});

describe("addFilter", () => {
  it("does not stack a question that is already being asked", () => {
    const once = addFilter([], pick("tz", "eq", "UTC"));
    expect(addFilter(once, pick("tz", "eq", "UTC"))).toBe(once);
  });

  it("tells a null condition from a comparison with the letters", () => {
    const withNull = addFilter([], pick("tz", "eq", null));
    expect(addFilter(withNull, pick("tz", "eq", "NULL"))).toHaveLength(2);
  });

  it("stacks conditions on different values of one column", () => {
    const both = addFilter(addFilter([], pick("tz", "eq", "UTC")), pick("tz", "eq", "CST"));
    expect(both.map(filterLabel)).toEqual(["tz = 'UTC'", "tz = 'CST'"]);
    // And the value is part of it: the same operator on another value is
    // another condition.
    expect(addFilter(both, pick("tz", "ne", "UTC"))).toHaveLength(3);
  });

  it("reads a typed IS NULL and a clicked one as one condition", () => {
    // The two are spelled differently inside — the menu writes the cell's text
    // as the value, an expression writes none — and mean the same thing. A
    // right-click onto a filter the box already asks for has to be a no-op, or
    // the same question would be asked twice and shown twice.
    const typed: CellFilter = { column: "tz", operator: "eq", value: "", isNull: true };
    const clicked = pick("tz", "eq", null);
    expect(filterLabel(typed)).toBe(filterLabel(clicked));
    expect(addFilter([typed], clicked)).toHaveLength(1);
  });
});

describe("expressionFor", () => {
  it("writes the conditions as the text that would ask for them again", () => {
    const filters = [pick("tz", "eq", "UTC"), pick("note", "like", "50%")];
    const text = "tz = 'UTC' AND note LIKE '%50\\%%'";
    expect(expressionFor(filters)).toBe(text);
    // Which is the point of it: what a chip removal writes back into the box is
    // the same expression the box would have parsed into those chips.
    expect(parseFilter(text, ["tz", "note"])).toEqual({ terms: filters });
  });

  it("is empty when nothing is filtered, which is how the box is cleared", () => {
    expect(expressionFor([])).toBe("");
  });
});

describe("orderedRows", () => {
  it("sorts and then filters, so what is exported is what is on screen", () => {
    const page = rows({ n: 1 }, { n: 3 }, { n: 2 });
    expect(orderedRows(page, [{ column: "n", desc: true }], [])).toEqual([
      { n: 3 },
      { n: 2 },
      { n: 1 }
    ]);
    expect(orderedRows(page, [{ column: "n", desc: true }], [pick("n", "gt", 1)])).toEqual([
      { n: 3 },
      { n: 2 }
    ]);
  });
});
