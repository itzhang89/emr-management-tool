import { describe, expect, it } from "vitest";
import { toCsv } from "./dbCsv";

describe("toCsv", () => {
  it("writes a header row and one line per record", () => {
    const csv = toCsv(["id", "name"], [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" }
    ]);

    expect(csv).toBe("id,name\n1,Ada\n2,Grace");
  });

  it("quotes only the values that would otherwise split", () => {
    const csv = toCsv(["note"], [{ note: "plain" }, { note: "has,comma" }, { note: 'has"quote' }]);

    expect(csv).toBe('note\nplain\n"has,comma"\n"has""quote"');
  });

  it("keeps a newline inside one value inside one record", () => {
    const csv = toCsv(["note"], [{ note: "line one\nline two" }]);

    expect(csv).toBe('note\n"line one\nline two"');
  });

  it("leaves a missing value empty rather than writing the word null", () => {
    const csv = toCsv(["a", "b"], [{ a: null, b: undefined }, { a: 0, b: false }]);

    // Zero and false are values; only absence is blank.
    expect(csv).toBe("a,b\n,\n0,false");
  });

  it("renders a structured cell as JSON", () => {
    const csv = toCsv(["payload"], [{ payload: { nested: true } }]);

    expect(csv).toBe('payload\n"{""nested"":true}"');
  });
});
