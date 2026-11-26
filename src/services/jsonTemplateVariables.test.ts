import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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

  it("lets CodeMirror filter by the variable name after the opening delimiter", async () => {
    const completion = createTemplateVariableCompletion(() => ["virtualClusterId", "submitUser"]);
    const state = EditorState.create({ doc: "${vir" });
    const result = await completion(new CompletionContext(state, state.doc.length, false));

    expect(result?.from).toBe(2);
    expect(result?.options.map(({ label }) => label)).toEqual(["virtualClusterId", "submitUser"]);
  });

  it("replaces a variable name inside an existing placeholder while preserving its date format", async () => {
    const completion = createTemplateVariableCompletion(() => ["datetime"]);
    const state = EditorState.create({ doc: '"${date:YYYY-MM-DD}"', selection: { anchor: 5 } });
    const view = new EditorView({ state });
    try {
      const result = await completion(new CompletionContext(state, 5, false));
      const option = result?.options[0];
      if (!result || !option || typeof option.apply !== "function") throw new Error("Expected a variable completion");
      option.apply(view, option, result.from, 5);
      expect(view.state.doc.toString()).toBe('"${datetime:YYYY-MM-DD}"');
    } finally {
      view.destroy();
    }
  });
});
