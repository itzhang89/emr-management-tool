import { describe, expect, it } from "vitest";
import {
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

  it("uses fit-content sizing for boolean and enum variables", () => {
    expect(getVariableFieldLayoutClass({ name: "enabled", type: "boolean" })).toContain("shrink-0");
    expect(getVariableFieldLayoutClass({ name: "env", type: "enum", options: ["dev", "prod"] })).toContain(
      "shrink-0"
    );
  });
});

describe("getVariableFieldLayoutStyle", () => {
  it("sizes boolean fields from label and output values", () => {
    expect(
      getVariableFieldLayoutStyle({
        name: "adaptive_query_execution_enabled",
        type: "boolean",
        format: "lowercase"
      })
    ).toEqual({
      minWidth: "32ch",
      width: "fit-content",
      maxWidth: "100%"
    });
  });

  it("sizes boolean fields from capitalized output values", () => {
    expect(
      getVariableFieldLayoutStyle({
        name: "enabled",
        type: "boolean",
        format: "capitalized"
      })
    ).toEqual({
      minWidth: "10ch",
      width: "fit-content",
      maxWidth: "100%"
    });
  });

  it("sizes small enum fields from label and option values", () => {
    expect(
      getVariableFieldLayoutStyle({
        name: "env",
        type: "enum",
        options: ["dev", "staging", "production"]
      })
    ).toEqual({
      minWidth: "34ch",
      width: "fit-content",
      maxWidth: "100%"
    });
  });

  it("sizes select enum fields from the longest option", () => {
    expect(
      getVariableFieldLayoutStyle({
        name: "region",
        type: "enum",
        options: ["us-east-1", "ap-southeast-1", "eu-central-1", "sa-east-1", "ca-central-1"]
      })
    ).toEqual({
      minWidth: "22ch",
      width: "fit-content",
      maxWidth: "100%"
    });
  });

  it("does not apply fit-content sizing to text fields", () => {
    expect(getVariableFieldLayoutStyle({ name: "job_name", type: "text" })).toBeUndefined();
  });
});
