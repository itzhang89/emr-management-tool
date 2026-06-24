export type BooleanOutputStyle = "lowercase" | "capitalized" | "numeric";

export const BOOLEAN_OUTPUT_OPTIONS: { value: BooleanOutputStyle; label: string }[] = [
  { value: "lowercase", label: "true / false" },
  { value: "capitalized", label: "True / False" },
  { value: "numeric", label: "1 / 0" }
];

export function defaultBooleanOutputStyle(): BooleanOutputStyle {
  return "lowercase";
}

export function parseBooleanOutputStyle(format?: string): BooleanOutputStyle {
  if (format === "capitalized" || format === "numeric") {
    return format;
  }
  return defaultBooleanOutputStyle();
}

export function formatBooleanValue(value: boolean, style: BooleanOutputStyle = defaultBooleanOutputStyle()): string {
  switch (style) {
    case "capitalized":
      return value ? "True" : "False";
    case "numeric":
      return value ? "1" : "0";
    case "lowercase":
    default:
      return value ? "true" : "false";
  }
}

export function resolveBooleanDefaultValue(defaultValue?: boolean): boolean {
  return Boolean(defaultValue);
}

export function describeBooleanVariable(format: string | undefined, defaultValue?: boolean): string {
  const style = parseBooleanOutputStyle(format);
  const value = resolveBooleanDefaultValue(defaultValue);
  const defaultOutput = formatBooleanValue(value, style);
  const checkedOutput = formatBooleanValue(true, style);
  const uncheckedOutput = formatBooleanValue(false, style);

  return `Default: ${value ? "checked" : "unchecked"} → "${defaultOutput}". Checked → "${checkedOutput}"; unchecked → "${uncheckedOutput}".`;
}
