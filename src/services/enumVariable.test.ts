import { describe, expect, it } from "vitest";
import { inferEnumDisplayFormat, parseEnumDisplayFormat } from "@/services/enumVariable";

describe("enumVariable", () => {
  it("infers display format from option count when format is omitted", () => {
    expect(inferEnumDisplayFormat(2)).toBe("radio");
    expect(inferEnumDisplayFormat(4)).toBe("radio");
    expect(inferEnumDisplayFormat(5)).toBe("select");
    expect(inferEnumDisplayFormat(10)).toBe("select");
    expect(inferEnumDisplayFormat(11)).toBe("combobox");
  });

  it("uses explicit format values from the format field", () => {
    expect(parseEnumDisplayFormat("radio", ["a", "b", "c", "d", "e"])).toBe("radio");
    expect(parseEnumDisplayFormat("select", Array.from({ length: 20 }, (_, index) => `opt-${index}`))).toBe("select");
    expect(parseEnumDisplayFormat("combobox", ["dev", "prod"])).toBe("combobox");
  });

  it("falls back to inferred format for unknown values", () => {
    expect(parseEnumDisplayFormat(undefined, ["dev", "prod"])).toBe("radio");
    expect(parseEnumDisplayFormat("invalid", ["dev", "prod"])).toBe("radio");
  });
});
