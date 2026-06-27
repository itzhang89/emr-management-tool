import { describe, expect, it } from "vitest";
import { lineNumberToPosition, parseAthenaErrorLine } from "./athenaSqlErrors";

describe("athenaSqlErrors", () => {
  it("parses Athena line numbers from common error messages", () => {
    expect(parseAthenaErrorLine("line 3:8: mismatched input 'FROM'")).toBe(3);
    expect(parseAthenaErrorLine("SYNTAX_ERROR: line 1:15: extraneous input")).toBe(1);
  });

  it("maps line numbers to document positions", () => {
    const doc = "SELECT 1;\nSELECT bad;\nSELECT 3;";
    expect(lineNumberToPosition(doc, 2)).toEqual({ from: 10, to: 21 });
  });
});
