import {
  defaultBooleanOutputStyle,
  describeBooleanVariable,
  formatBooleanValue,
  parseBooleanOutputStyle
} from "@/services/booleanVariable";

describe("booleanVariable", () => {
  it("defaults to lowercase true/false", () => {
    expect(defaultBooleanOutputStyle()).toBe("lowercase");
    expect(formatBooleanValue(true)).toBe("true");
    expect(formatBooleanValue(false)).toBe("false");
    expect(parseBooleanOutputStyle()).toBe("lowercase");
    expect(parseBooleanOutputStyle("invalid")).toBe("lowercase");
  });

  it("supports capitalized True/False", () => {
    expect(formatBooleanValue(true, "capitalized")).toBe("True");
    expect(formatBooleanValue(false, "capitalized")).toBe("False");
  });

  it("supports numeric 1/0", () => {
    expect(formatBooleanValue(true, "numeric")).toBe("1");
    expect(formatBooleanValue(false, "numeric")).toBe("0");
  });

  it("describes boolean default and output values", () => {
    expect(describeBooleanVariable("lowercase", false)).toBe(
      'Default: unchecked → "false". Checked → "true"; unchecked → "false".'
    );
    expect(describeBooleanVariable("numeric", true)).toBe(
      'Default: checked → "1". Checked → "1"; unchecked → "0".'
    );
  });
});
