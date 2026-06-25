import { describe, expect, it } from "vitest";
import {
  getVariableFieldLayoutClass,
  VARIABLE_FIELDS_GRID_CLASS
} from "@/components/templates/variableFieldLayout";

describe("getVariableFieldLayoutClass", () => {
  it("uses auto-fill grid for the variable field container", () => {
    expect(VARIABLE_FIELDS_GRID_CLASS).toContain("auto-fill");
  });

  it("uses full width for multi-select variables", () => {
    expect(getVariableFieldLayoutClass({ name: "tags", type: "multiEnum", options: ["a", "b"] })).toBe(
      "col-span-full"
    );
  });

  it("uses wider span for small enum and date variables", () => {
    expect(getVariableFieldLayoutClass({ name: "env", type: "enum", options: ["dev", "prod"] })).toBe(
      "col-span-full sm:col-span-2"
    );
    expect(getVariableFieldLayoutClass({ name: "runAt", type: "dateTime" })).toBe("col-span-full sm:col-span-2");
  });

  it("keeps compact variables in a single grid cell", () => {
    expect(getVariableFieldLayoutClass({ name: "enabled", type: "boolean" })).toBe("min-w-0");
    expect(getVariableFieldLayoutClass({ name: "count", type: "number" })).toBe("min-w-0");
    expect(getVariableFieldLayoutClass({ name: "name", type: "text" })).toBe("min-w-0");
  });
});
