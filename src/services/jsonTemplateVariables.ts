import { insertCompletionText, pickedCompletion, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { BUILTIN_TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_PATTERN } from "@/services/templateEngine";

export interface TemplateVariableMatch {
  from: number;
  to: number;
  name: string;
  raw: string;
}

export interface TemplateVariableDiagnostic {
  from: number;
  to: number;
  severity: "warning";
  message: string;
}

export function scanTemplateVariables(text: string): TemplateVariableMatch[] {
  const matches: TemplateVariableMatch[] = [];
  const pattern = new RegExp(TEMPLATE_VARIABLE_PATTERN.source, "g");
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    matches.push({
      from: match.index,
      to: match.index + match[0].length,
      name,
      raw: match[0]
    });
  }
  return matches;
}

export function buildKnownTemplateVariables(customNames: string[]): string[] {
  const custom = customNames.map((n) => n.trim()).filter(Boolean);
  return [...new Set([...BUILTIN_TEMPLATE_VARIABLES, ...custom])];
}

export function diagnoseUnknownTemplateVariables(
  text: string,
  knownVariables: string[]
): TemplateVariableDiagnostic[] {
  const known = new Set(knownVariables);
  return scanTemplateVariables(text)
    .filter((match) => !known.has(match.name))
    .map((match) => ({
      from: match.from,
      to: match.to,
      severity: "warning" as const,
      message: `Unknown template variable: ${match.name}`
    }));
}

export function createTemplateVariableCompletion(getKnown: () => string[]): CompletionSource {
  return (context) => {
    const before = context.matchBefore(/\$\{\w*$/);
    if (!before) return null;
    const options: Completion[] = getKnown().map((name) => ({
      label: name,
      type: "variable",
      apply(view, completion, from, to) {
        const line = view.state.doc.lineAt(to);
        const suffix = /^\w*(:[^"}]+)?\}/.exec(line.text.slice(to - line.from));
        const insert = `${name}${suffix?.[1] ?? ""}}`;
        view.dispatch({
          ...insertCompletionText(view.state, insert, from, to + (suffix?.[0].length ?? 0)),
          annotations: pickedCompletion.of(completion)
        });
      }
    }));
    return {
      from: before.from + 2,
      options,
      validFor: /^\w*$/
    };
  };
}
