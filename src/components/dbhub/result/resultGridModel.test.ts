import { describe, expect, it } from "vitest";
import {
  allGroupKeys,
  buildGroupTree,
  cellText,
  cycleSort,
  flattenGroups,
  formatCell,
  groupLabel,
  sortRows,
  setSortDirection,
  toTsv,
  type Row
} from "./resultGridModel";

function rows(...values: Array<Record<string, unknown>>): Row[] {
  return values;
}

describe("formatCell", () => {
  it("tells a missing value apart from the word NULL", () => {
    // The whole point of the kind: these two used to render identically, so a
    // null was indistinguishable from four characters somebody stored.
    expect(formatCell(null)).toEqual({ text: "NULL", kind: "null" });
    expect(formatCell(undefined)).toEqual({ text: "NULL", kind: "null" });
    expect(formatCell("NULL")).toEqual({ text: "NULL", kind: "text" });
  });

  it("keeps numbers as numbers so they can be aligned and sorted", () => {
    expect(formatCell(42).kind).toBe("number");
    expect(formatCell(0).kind).toBe("number");
    // A numeric string is not a number — the engine chose to send it as text.
    expect(formatCell("42").kind).toBe("text");
  });

  it("draws a boolean as a word, not as 1 or 0", () => {
    expect(formatCell(true)).toEqual({ text: "true", kind: "boolean" });
    expect(formatCell(false)).toEqual({ text: "false", kind: "boolean" });
  });

  it("serialises nested values rather than printing [object Object]", () => {
    expect(formatCell({ a: 1 })).toEqual({ text: '{"a":1}', kind: "json" });
    expect(formatCell([1, 2])).toEqual({ text: "[1,2]", kind: "json" });
  });

  it("survives a value JSON.stringify refuses", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(formatCell(cyclic).kind).toBe("json");
  });
});

describe("sortRows", () => {
  it("returns the list untouched when nothing is sorted", () => {
    const input = rows({ id: 2 }, { id: 1 });
    expect(sortRows(input, [])).toBe(input);
  });

  it("sorts numbers by magnitude, not by digits", () => {
    const sorted = sortRows(rows({ n: 10 }, { n: 9 }, { n: 100 }), [{ column: "n", desc: false }]);
    expect(sorted.map((row) => row.n)).toEqual([9, 10, 100]);
  });

  it("sorts decimals that arrived as strings by magnitude too", () => {
    // Every engine hands back DECIMAL as text; sorting those by digits would
    // put 9.5 after 10.25.
    const sorted = sortRows(
      rows({ d: "10.25" }, { d: "9.5" }, { d: "100.75" }),
      [{ column: "d", desc: false }]
    );
    expect(sorted.map((row) => row.d)).toEqual(["9.5", "10.25", "100.75"]);
  });

  it("keeps nulls last in both directions", () => {
    const ascending = sortRows(rows({ v: 2 }, { v: null }, { v: 1 }), [
      { column: "v", desc: false }
    ]);
    const descending = sortRows(rows({ v: 2 }, { v: null }, { v: 1 }), [
      { column: "v", desc: true }
    ]);

    // A missing value is not "smaller than everything" — burying it under a
    // descending sort would hide the rows usually being looked for.
    expect(ascending.at(-1)?.v).toBeNull();
    expect(descending.at(-1)?.v).toBeNull();
    expect(descending[0]?.v).toBe(2);
  });

  it("breaks ties with the next column in the list", () => {
    const sorted = sortRows(
      rows({ a: 1, b: "z" }, { a: 1, b: "a" }, { a: 0, b: "m" }),
      [
        { column: "a", desc: false },
        { column: "b", desc: false }
      ]
    );

    expect(sorted.map((row) => `${row.a}${row.b}`)).toEqual(["0m", "1a", "1z"]);
  });

  it("leaves the input array alone", () => {
    const input = rows({ v: 2 }, { v: 1 });
    sortRows(input, [{ column: "v", desc: false }]);

    expect(input.map((row) => row.v)).toEqual([2, 1]);
  });
});

describe("cycleSort", () => {
  it("walks a column through ascending, descending, and off", () => {
    const first = cycleSort([], "a", false);
    expect(first).toEqual([{ column: "a", desc: false }]);

    const second = cycleSort(first, "a", false);
    expect(second).toEqual([{ column: "a", desc: true }]);

    expect(cycleSort(second, "a", false)).toEqual([]);
  });

  it("replaces the order when the click is not additive", () => {
    const existing = [{ column: "a", desc: false }];
    expect(cycleSort(existing, "b", false)).toEqual([{ column: "b", desc: false }]);
  });

  it("appends when the click is additive, keeping the earlier priority", () => {
    const existing = [{ column: "a", desc: true }];
    expect(cycleSort(existing, "b", true)).toEqual([
      { column: "a", desc: true },
      { column: "b", desc: false }
    ]);
  });

  it("drops a column from the middle without disturbing the rest", () => {
    const existing = [
      { column: "a", desc: true },
      { column: "b", desc: true },
      { column: "c", desc: false }
    ];
    expect(cycleSort(existing, "b", true)).toEqual([
      { column: "a", desc: true },
      { column: "c", desc: false }
    ]);
  });
});

describe("setSortDirection", () => {
  it("adds the column when it was not sorting", () => {
    expect(setSortDirection([], "a", false)).toEqual([{ column: "a", desc: false }]);
  });

  it("keeps the column's priority when only its direction changes", () => {
    // Appending instead would silently demote the column the user just asked
    // to sort by, whenever it happened to be sorted already.
    const existing = [
      { column: "a", desc: false },
      { column: "b", desc: false }
    ];
    expect(setSortDirection(existing, "a", true)).toEqual([
      { column: "a", desc: true },
      { column: "b", desc: false }
    ]);
  });

  it("leaves the input alone", () => {
    const existing = [{ column: "a", desc: false }];
    setSortDirection(existing, "a", true);

    expect(existing).toEqual([{ column: "a", desc: false }]);
  });
});

describe("buildGroupTree", () => {
  const sample = rows(
    { status: "running", age: "2m", name: "a" },
    { status: "running", age: "7m", name: "b" },
    { status: "failed", age: "2m", name: "c" }
  );

  it("returns nothing when nothing is grouped", () => {
    expect(buildGroupTree(sample, [])).toEqual([]);
  });

  it("buckets rows by the grouped column, keeping first-seen order", () => {
    const tree = buildGroupTree(sample, ["status"]);

    expect(tree.map((node) => node.value)).toEqual(["running", "failed"]);
    expect(tree.map((node) => node.count)).toEqual([2, 1]);
    // Rows hang off the deepest level only.
    expect(tree[0]?.rows.map((row) => row.name)).toEqual(["a", "b"]);
  });

  it("nests a second level under the first", () => {
    const tree = buildGroupTree(sample, ["status", "age"]);

    const running = tree[0];
    expect(running?.children.map((node) => node.value)).toEqual(["2m", "7m"]);
    expect(running?.rows).toEqual([]);
    expect(running?.count).toBe(2);
    expect(running?.children[0]?.depth).toBe(1);
  });

  it("counts everything beneath an interior node", () => {
    const tree = buildGroupTree(sample, ["status", "age"]);
    expect(tree[0]?.count).toBe(2);
    expect(tree[1]?.count).toBe(1);
  });

  it("keeps a null group rather than dropping those rows", () => {
    const tree = buildGroupTree(rows({ v: 1 }, { v: null }), ["v"]);

    expect(tree).toHaveLength(2);
    expect(groupLabel(tree[1]?.value)).toBe("(NULL)");
  });

  it("does not merge two distinct values that stringify alike", () => {
    const tree = buildGroupTree(rows({ v: 1 }, { v: "1" }), ["v"]);

    expect(tree).toHaveLength(2);
  });
});

describe("flattenGroups", () => {
  const sample = rows(
    { status: "running", name: "a" },
    { status: "running", name: "b" },
    { status: "failed", name: "c" }
  );
  const indexOf = (row: Row) => sample.indexOf(row);

  it("emits a header per group, then its rows", () => {
    const tree = buildGroupTree(sample, ["status"]);
    const lines = flattenGroups(tree, new Set(), indexOf);

    expect(lines.map((line) => line.kind)).toEqual(["group", "row", "row", "group", "row"]);
  });

  it("hides a folded group's rows but keeps its header", () => {
    const tree = buildGroupTree(sample, ["status"]);
    const collapsed = new Set([tree[0]!.key]);
    const lines = flattenGroups(tree, collapsed, indexOf);

    expect(lines.map((line) => line.kind)).toEqual(["group", "group", "row"]);
    expect(lines[0]).toMatchObject({ collapsed: true });
  });

  it("indents a row one step in from its group", () => {
    const tree = buildGroupTree(sample, ["status"]);
    const lines = flattenGroups(tree, new Set(), indexOf);
    const row = lines.find((line) => line.kind === "row");

    expect(row).toMatchObject({ depth: 1 });
  });

  it("carries the page index through, so a row survives sorting", () => {
    const tree = buildGroupTree(sample, ["status"]);
    const lines = flattenGroups(tree, new Set(), indexOf);
    const indexes = lines
      .filter((line) => line.kind === "row")
      .map((line) => (line as { index: number }).index);

    expect(indexes).toEqual([0, 1, 2]);
  });
});

describe("allGroupKeys", () => {
  it("collects every key so collapse-all can reach the nested ones", () => {
    const tree = buildGroupTree(
      rows({ a: "x", b: "1" }, { a: "x", b: "2" }),
      ["a", "b"]
    );
    const keys = allGroupKeys(tree);

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("toTsv", () => {
  it("writes a header line then one line per row", () => {
    const text = toTsv(["id", "name"], rows({ id: 1, name: "a" }));

    expect(text).toBe("id\tname\n1\ta");
  });

  it("spells a null the way the grid does", () => {
    expect(toTsv(["v"], rows({ v: null }))).toBe("v\nNULL");
  });

  it("quotes only the values that would break the shape", () => {
    const text = toTsv(["v"], rows({ v: "a\tb" }, { v: 'say "hi"' }, { v: "plain" }));

    expect(text).toBe('v\n"a\tb"\n"say ""hi"""\nplain');
  });
});

describe("cellText", () => {
  it("matches what the grid draws", () => {
    expect(cellText(null)).toBe("NULL");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("groupLabel", () => {
  it("names a null group rather than showing an empty header", () => {
    expect(groupLabel(null)).toBe("(NULL)");
    expect(groupLabel("running")).toBe("running");
  });
});
