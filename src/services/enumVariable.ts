export type EnumDisplayFormat = "radio" | "select" | "combobox";

export const ENUM_DISPLAY_OPTIONS: { value: EnumDisplayFormat; label: string }[] = [
  { value: "radio", label: "Radio buttons" },
  { value: "select", label: "Dropdown" },
  { value: "combobox", label: "Searchable dropdown" }
];

export function inferEnumDisplayFormat(optionCount: number): EnumDisplayFormat {
  if (optionCount <= 4) {
    return "radio";
  }
  if (optionCount <= 10) {
    return "select";
  }
  return "combobox";
}

export function parseEnumDisplayFormat(format: string | undefined, options: string[] = []): EnumDisplayFormat {
  if (format === "radio" || format === "select" || format === "combobox") {
    return format;
  }

  return inferEnumDisplayFormat(options.length);
}
