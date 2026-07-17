import { describe, expect, it } from "vitest";
import {
  buildKnownTemplateVariables,
  diagnoseUnknownTemplateVariables,
  scanTemplateVariables
} from "./jsonTemplateVariables";
import { BUILTIN_TEMPLATE_VARIABLES } from "./templateEngine";

describe("jsonTemplateVariables", () => {
  it("scans plain and patterned placeholders", () => {
    const text = '"${virtualClusterId}" "${date:YYYY-MM-DD}" "${}"';
    const matches = scanTemplateVariables(text);
    expect(matches.map((m) => m.name)).toEqual(["virtualClusterId", "date"]);
    expect(matches[1]?.raw).toBe("${date:YYYY-MM-DD}");
  });

  it("builds known set from builtins and non-empty custom names", () => {
    expect(buildKnownTemplateVariables(["ENV", "", "  ", "JOB"])).toEqual([
      ...BUILTIN_TEMPLATE_VARIABLES,
      "ENV",
      "JOB"
    ]);
  });

  it("warns on unknown variables only", () => {
    const text = '{"a":"${virtualClusterId}","b":"${missing}"}';
    const known = buildKnownTemplateVariables([]);
    const diagnostics = diagnoseUnknownTemplateVariables(text, known);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("missing");
    expect(diagnostics[0]?.severity).toBe("warning");
  });
});
