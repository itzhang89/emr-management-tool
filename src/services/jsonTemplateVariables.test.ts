import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  buildKnownTemplateVariables,
  createTemplateVariableCompletion,
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

  it("completes matching variable names with full placeholders", async () => {
    const completion = createTemplateVariableCompletion(() => ["virtualClusterId", "submitUser"]);
    const state = EditorState.create({ doc: "${vir" });
    const result = await completion(new CompletionContext(state, state.doc.length, true));

    expect(result?.from).toBe(0);
    expect(result?.options).toEqual([
      expect.objectContaining({
        label: "virtualClusterId",
        apply: "${virtualClusterId}"
      })
    ]);
  });
});
