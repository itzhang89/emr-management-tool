import { type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
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
  return [...BUILTIN_TEMPLATE_VARIABLES, ...custom];
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
  return (context: CompletionContext) => {
    const before = context.matchBefore(/\$\{[a-zA-Z0-9_]*$/);
    if (!before) return null;
    const typed = before.text.slice(2); // after `${`
    const options: Completion[] = getKnown()
      .filter((name) => name.toLowerCase().startsWith(typed.toLowerCase()))
      .map((name) => ({
        label: name,
        type: "variable",
        apply: `\${${name}}`
      }));
    return {
      from: before.from,
      options,
      validFor: /^\$\{[a-zA-Z0-9_]*$/
    };
  };
}
