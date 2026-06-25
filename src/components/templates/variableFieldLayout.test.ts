import { describe, expect, it } from "vitest";
import {
  COMPACT_FIELD_WRAPPER_STYLE,
  getBooleanControlStyle,
  getDateControlStyle,
  getEnumControlStyle,
  getNumberInputStyle,
  getRadioEnumShellStyle,
  getSelectControlStyle,
  getVariableFieldLayoutClass,
  getVariableFieldLayoutStyle,
  VARIABLE_FIELDS_CONTAINER_CLASS
} from "@/components/templates/variableFieldLayout";

describe("getVariableFieldLayoutClass", () => {
  it("uses a wrapping flex container", () => {
    expect(VARIABLE_FIELDS_CONTAINER_CLASS).toContain("flex-wrap");
  });

  it("uses full width for multi-select variables", () => {
    expect(getVariableFieldLayoutClass({ name: "tags", type: "multiEnum", options: ["a", "b"] })).toBe("w-full");
  });

  it("uses fit-content sizing for compact variables", () => {
    expect(getVariableFieldLayoutClass({ name: "enabled", type: "boolean" })).toContain("shrink-0");
    expect(getVariableFieldLayoutClass({ name: "env", type: "enum", options: ["dev", "prod"] })).toContain(
      "shrink-0"
    );
    expect(getVariableFieldLayoutClass({ name: "runAt", type: "dateTime" })).toContain("shrink-0");
    expect(getVariableFieldLayoutClass({ name: "count", type: "number" })).toContain("shrink-0");
  });
});

describe("compact control styles", () => {
  it("uses a fit-content wrapper without label-based min width", () => {
    expect(
      getVariableFieldLayoutStyle({
        name: "adaptive_query_execution_enabled",
        type: "boolean",
        format: "lowercase"
      })
    ).toEqual(COMPACT_FIELD_WRAPPER_STYLE);
  });

  it("sizes number inputs from digit count with a readable minimum width", () => {
    expect(getNumberInputStyle(0)).toEqual({ width: "max(4.5rem, 7ch)", maxWidth: "100%" });
    expect(getNumberInputStyle(2)).toEqual({ width: "max(4.5rem, 7ch)", maxWidth: "100%" });
    expect(getNumberInputStyle(1024)).toEqual({ width: "max(4.5rem, 7ch)", maxWidth: "100%" });
    expect(getNumberInputStyle(123456)).toEqual({ width: "max(4.5rem, 9ch)", maxWidth: "100%" });
  });

  it("sizes select-like controls from visible text", () => {
    expect(getSelectControlStyle("dev")).toEqual({ width: "6ch", maxWidth: "100%" });
    expect(getSelectControlStyle("2026-06-24")).toEqual({ width: "13ch", maxWidth: "100%" });
  });

  it("sizes boolean controls from output text", () => {
    expect(getBooleanControlStyle("lowercase", false)).toEqual({ width: "8ch", maxWidth: "100%" });
  });

  it("sizes enum select controls from the selected value", () => {
    expect(
      getEnumControlStyle(
        {
          name: "ENV",
          type: "enum",
          format: "select",
          options: ["dev", "prod"]
        },
        "dev"
      )
    ).toEqual({ width: "6ch", maxWidth: "100%" });
  });

  it("does not force width for enum radio groups", () => {
    expect(
      getEnumControlStyle({
        name: "ENV",
        type: "enum",
        format: "radio",
        options: ["dev", "prod"]
      })
    ).toBeUndefined();
  });

  it("sizes enum radio shells from option labels", () => {
    expect(getRadioEnumShellStyle(["dev", "prod"])).toEqual({ width: "17ch", maxWidth: "100%" });
  });

  it("sizes date controls from the displayed value", () => {
    expect(
      getDateControlStyle(
        {
          name: "biz_date",
          type: "date"
        },
        "2026-06-24"
      )
    ).toEqual({ width: "13ch", maxWidth: "100%" });
  });

  it("does not apply fit-content sizing to text fields", () => {
    expect(getVariableFieldLayoutStyle({ name: "job_name", type: "text" })).toBeUndefined();
  });
});
