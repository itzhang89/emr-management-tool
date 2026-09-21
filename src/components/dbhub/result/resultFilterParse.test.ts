import { describe, expect, it } from "vitest";
import type { CellFilter } from "@/services/dbWorkspaceCache";
import { completionAt, parseFilter, suggestionsFor } from "./resultFilterParse";

const COLUMNS = ["id", "time_zone", "region", "note"];

function condition(
  column: string,
  operator: CellFilter["operator"],
  value: string,
  isNull = false
): CellFilter {
  return { column, operator, value, isNull };
}

/** The terms a text parses to, insisting that it parses at all. */
function terms(text: string, columns = COLUMNS): CellFilter[] {
  const parsed = parseFilter(text, columns);
  if ("error" in parsed) throw new Error(`expected "${text}" to parse, got: ${parsed.error}`);
  return parsed.terms;
}

/** Why a text was refused. */
function refusal(text: string, columns = COLUMNS): string {
  const parsed = parseFilter(text, columns);
  if (!("error" in parsed)) throw new Error(`expected "${text}" to be refused`);
  return parsed.error;
}

describe("parseFilter", () => {
  it("reads one comparison", () => {
    expect(terms("id = 3")).toEqual([condition("id", "eq", "3")]);
    expect(terms("id <> 3")).toEqual([condition("id", "ne", "3")]);
    expect(terms("id != 3")).toEqual([condition("id", "ne", "3")]);
    expect(terms("id > 3")).toEqual([condition("id", "gt", "3")]);
    expect(terms("id < 3")).toEqual([condition("id", "lt", "3")]);
    // Spacing is the writer's business, not the language's.
    expect(terms("  id   =3 ")).toEqual([condition("id", "eq", "3")]);
    // A negative number is a number, not a minus sign and a word.
    expect(terms("id > -2.5")).toEqual([condition("id", "gt", "-2.5")]);
  });

  it("joins conditions with AND", () => {
    expect(terms("time_zone = 'UTC' AND id > 2")).toEqual([
      condition("time_zone", "eq", "UTC"),
      condition("id", "gt", "2")
    ]);
    // In any case, as SQL keywords are.
    expect(terms("id = 1 and id = 2")).toHaveLength(2);
  });

  it("reads nothing as no conditions, which is how the box is emptied", () => {
    expect(terms("")).toEqual([]);
    expect(terms("   ")).toEqual([]);
  });

  it("matches a bare name without regard to case and a quoted one exactly", () => {
    // The header shows what the engine decided to call the column, so a name
    // typed in another case is the same column — while `"ID"` is the exact name
    // the user asked for, and this result has no such column.
    expect(terms("TIME_ZONE = 'UTC'")).toEqual([condition("time_zone", "eq", "UTC")]);
    expect(terms('"time_zone" = \'UTC\'')).toEqual([condition("time_zone", "eq", "UTC")]);
    expect(terms("`time_zone` = 'UTC'")).toEqual([condition("time_zone", "eq", "UTC")]);
    expect(refusal('"TIME_ZONE" = \'UTC\'')).toContain("TIME_ZONE");
  });

  it("keeps the value as written, quotes and all", () => {
    expect(terms("note = 'o''brien'")).toEqual([condition("note", "eq", "o'brien")]);
    // A `%` inside a value is a percent sign: wildcards are what LIKE is for.
    expect(terms("note = '100%'")).toEqual([condition("note", "eq", "100%")]);
  });

  it("takes a LIKE pattern as the pattern it is", () => {
    expect(terms("note LIKE '%job%'")).toEqual([condition("note", "like", "%job%")]);
    expect(terms("note LIKE 'job'")).toEqual([condition("note", "like", "job")]);
  });

  it("asks whether a value is missing", () => {
    expect(terms("note IS NULL")).toEqual([condition("note", "eq", "", true)]);
    expect(terms("note IS NOT NULL")).toEqual([condition("note", "ne", "", true)]);
    // `= NULL` is the same question asked in the comparison's words, and the
    // only honest reading of it: nothing is ever *equal to* nothing.
    expect(terms("note = NULL")).toEqual([condition("note", "eq", "", true)]);
    expect(terms("note <> NULL")).toEqual([condition("note", "ne", "", true)]);
  });

  it("refuses anything that would widen the question rather than narrow it", () => {
    // Read as ANDs instead of refused, `a OR b` would leave the rows the user
    // asked for out of a grid that looks perfectly fine.
    expect(refusal("id = 1 OR id = 2")).toContain("OR is not supported");
    expect(refusal("(id = 1 AND id = 2)")).toContain("Parentheses are not supported");
    expect(refusal("id IN (1, 2)")).toContain("IN is not supported");
    expect(refusal("id BETWEEN 1 AND 2")).toContain("BETWEEN is not supported");
    expect(refusal("id >= 2")).toContain('">=" is not supported');
    expect(refusal("id <= 2")).toContain('"<=" is not supported');
  });

  it("refuses text it cannot read, naming the part it stumbled on", () => {
    expect(refusal("id =")).toContain("nothing to compare with");
    expect(refusal("region")).toContain("not compared with anything");
    expect(refusal("id = 1 AND")).toContain("ends with AND");
    expect(refusal("id = 1 id = 2")).toContain("joined with AND");
    expect(refusal("state = 'open")).toContain("unclosed string");
    expect(refusal("nosuch = 1")).toContain("no column named");
    // A bare word where a value goes is a typo far more often than a column,
    // and guessing which would make the meaning depend on the data.
    expect(refusal("region = northeast")).toContain("quoted");
    expect(refusal("id = 1; DROP TABLE orders")).toContain("joined with AND");
  });

  it("refuses a comparison with nothing that can be compared", () => {
    expect(refusal("note > NULL")).toContain("IS NULL");
    expect(refusal("note LIKE NULL")).toContain("quoted pattern");
    expect(refusal("note LIKE 12")).toContain("quoted pattern");
  });
});

describe("completionAt", () => {
  it("knows a column is due at the start and after AND", () => {
    expect(completionAt("reg", 3)).toEqual({ start: 0, prefix: "reg", expects: "column" });
    expect(completionAt("id = 1 AND reg", 14)).toEqual({
      start: 11,
      prefix: "reg",
      expects: "column"
    });
  });

  it("knows a comparison is due after a name and a value after that", () => {
    expect(completionAt("region ", 7)).toEqual({ start: 7, prefix: "", expects: "operator" });
    expect(completionAt("region >", 8)).toEqual({ start: 8, prefix: "", expects: "value" });
    expect(completionAt("id = 1 ", 7)).toEqual({ start: 7, prefix: "", expects: "and" });
  });

  it("knows NULL follows IS — and NOT — and nothing follows that", () => {
    expect(completionAt("note IS ", 8)).toEqual({ start: 8, prefix: "", expects: "null" });
    expect(completionAt("note IS NOT ", 12)).toEqual({ start: 12, prefix: "", expects: "null" });
    expect(completionAt("note IS NULL ", 13).expects).toBe("and");
  });
});

describe("suggestionsFor", () => {
  const offer = (text: string) => suggestionsFor(completionAt(text, text.length), COLUMNS);

  it("offers the columns the typed letters could be", () => {
    expect(offer("reg")).toEqual(["region"]);
    expect(offer("time_z")).toEqual(["time_zone"]);
    // Nothing typed narrows nothing: a column position offers the whole list,
    // and the box is what decides when that is worth showing — see
    // `ResultFilterBar`.
    expect(suggestionsFor({ start: 0, prefix: "", expects: "column" }, COLUMNS)).toEqual(COLUMNS);
  });

  it("offers the comparisons once a column is named", () => {
    expect(offer("region ")).toEqual(["=", "<>", ">", "<", "LIKE", "IS NULL", "IS NOT NULL"]);
    // And a word that could be either is a column: `no` is `note`, not a typo
    // for a keyword.
    expect(offer("no")).toEqual(["note"]);
    // Unless no column could be meant, and then the keyword is the offer.
    expect(offer("region LI")).toEqual(["LIKE"]);
  });

  it("offers NULL where NULL is the answer", () => {
    expect(offer("note IS ")).toEqual(["NULL", "NOT NULL"]);
  });

  it("offers nothing where a value goes", () => {
    expect(offer("region = ")).toEqual([]);
  });
});
