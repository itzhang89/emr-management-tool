import { describe, expect, it } from "vitest";
import {
  COMPACT_FIELD_WRAPPER_STYLE,
  getBooleanShellStyle,
  getCompactVariableShellStyle,
  getDateShellStyle,
  getEnumSelectShellStyle,
  getNumberShellStyle,
  getRadioEnumShellStyle,
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

  it("keeps boolean width stable across checked states", () => {
    const definition = { name: "enabled", type: "boolean" as const, format: "lowercase" };
    const shellStyle = getBooleanShellStyle(definition);

    expect(shellStyle).toEqual({ width: "11ch", maxWidth: "100%" });
    expect(getCompactVariableShellStyle(definition)).toEqual(shellStyle);
  });

  it("sizes boolean fields from the longest output value", () => {
    expect(getBooleanShellStyle({ name: "enabled", type: "boolean", format: "capitalized" })).toEqual({
      width: "11ch",
      maxWidth: "100%"
    });
    expect(getBooleanShellStyle({ name: "enabled", type: "boolean", format: "numeric" })).toEqual({
      width: "7ch",
      maxWidth: "100%"
    });
  });

  it("keeps number width stable regardless of the current value", () => {
    const definition = { name: "count", type: "number" as const, defaultValue: 1024 };
    const shellStyle = getNumberShellStyle(definition);

    expect(shellStyle).toEqual({ width: "max(4.5rem, 7ch)", maxWidth: "100%" });
    expect(getNumberShellStyle({ name: "count", type: "number", defaultValue: 2 })).toEqual(shellStyle);
    expect(getNumberShellStyle({ name: "count", type: "number" })).toEqual({
      width: "max(4.5rem, 7ch)",
      maxWidth: "100%"
    });
  });

  it("sizes number fields from default value digit count", () => {
    expect(getNumberShellStyle({ name: "count", type: "number", defaultValue: 123456789 })).toEqual({
      width: "max(4.5rem, 12ch)",
      maxWidth: "100%"
    });
  });

  it("keeps enum select width stable from the longest option", () => {
    const definition = {
      name: "ENV",
      type: "enum" as const,
      format: "select",
      label: "Environment",
      options: ["dev", "production"]
    };
    const shellStyle = getEnumSelectShellStyle(definition);

    expect(shellStyle).toEqual({ width: "21ch", maxWidth: "100%" });
    expect(getCompactVariableShellStyle(definition)).toEqual(shellStyle);
  });

  it("includes enum placeholder text in select width", () => {
    expect(
      getEnumSelectShellStyle({
        name: "env",
        type: "enum",
        label: "Very Long Environment Label",
        options: ["dev"]
      })
    ).toEqual({ width: "37ch", maxWidth: "100%" });
  });

  it("sizes enum radio shells from option labels", () => {
    expect(getRadioEnumShellStyle(["dev", "prod"])).toEqual({ width: "17ch", maxWidth: "100%" });
  });

  it("keeps date width stable from placeholder and format pattern", () => {
    const definition = { name: "biz_date", type: "date" as const };
    const shellStyle = getDateShellStyle(definition);

    expect(shellStyle).toEqual({ width: "16ch", maxWidth: "100%" });
    expect(getDateShellStyle(definition)).toEqual(shellStyle);
  });

  it("does not apply fit-content sizing to text fields", () => {
    expect(getVariableFieldLayoutStyle({ name: "job_name", type: "text" })).toBeUndefined();
    expect(getCompactVariableShellStyle({ name: "job_name", type: "text" })).toBeUndefined();
  });
});
