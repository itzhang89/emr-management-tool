import type { CSSProperties } from "react";
import type { TemplateVariableDefinition } from "@/types/domain";
import { formatBooleanValue, parseBooleanOutputStyle } from "@/services/booleanVariable";
import { defaultFormatForVariableType, formatWithPattern, parseDateValue } from "@/services/dateFormat";
import { parseEnumDisplayFormat } from "@/services/enumVariable";

export const VARIABLE_FIELDS_CONTAINER_CLASS = "flex flex-wrap items-start gap-x-4 gap-y-4";

const MIN_FIELD_WIDTH_CH = 8;
const CONTROL_PADDING_CH = 5;
const RADIO_OPTION_OVERHEAD_CH = 3;
const SELECT_PLACEHOLDER_OVERHEAD_CH = 8;
const DATE_CONTROL_OVERHEAD_CH = 4;

type VariableFieldValue = string | number | boolean | string[] | undefined;

function variableLabel(definition: TemplateVariableDefinition): string {
  return definition.label ?? definition.name;
}

function labelMinWidthCh(label: string): number {
  return Math.max(label.length, MIN_FIELD_WIDTH_CH);
}

function booleanContentWidthCh(format?: string): number {
  const style = parseBooleanOutputStyle(format);
  const falseOutput = formatBooleanValue(false, style);
  const trueOutput = formatBooleanValue(true, style);

  return Math.max(falseOutput.length, trueOutput.length) + CONTROL_PADDING_CH;
}

function enumRadioContentWidthCh(options: string[]): number {
  if (options.length === 0) {
    return MIN_FIELD_WIDTH_CH;
  }

  return options.reduce((sum, option) => sum + option.length + RADIO_OPTION_OVERHEAD_CH, CONTROL_PADDING_CH);
}

function enumSelectContentWidthCh(options: string[], label: string): number {
  const placeholderLength = `Select ${label}`.length;
  const longestOption = options.reduce((max, option) => Math.max(max, option.length), 0);

  return Math.max(longestOption, placeholderLength) + SELECT_PLACEHOLDER_OVERHEAD_CH;
}

function dateFormatDisplayWidthCh(format: string): number {
  let width = 0;

  for (let index = 0; index < format.length; ) {
    if (format.startsWith("YYYY", index)) {
      width += 4;
      index += 4;
      continue;
    }
    if (format.startsWith("MM", index)) {
      width += 2;
      index += 2;
      continue;
    }
    if (format.startsWith("DD", index)) {
      width += 2;
      index += 2;
      continue;
    }
    if (format.startsWith("HH", index)) {
      width += 2;
      index += 2;
      continue;
    }
    if (format.startsWith("mm", index)) {
      width += 2;
      index += 2;
      continue;
    }
    if (format.startsWith("ss", index)) {
      width += 2;
      index += 2;
      continue;
    }

    width += 1;
    index += 1;
  }

  return width;
}

function dateContentWidthCh(definition: TemplateVariableDefinition, value?: VariableFieldValue): number {
  const label = variableLabel(definition);
  const format =
    definition.format ??
    defaultFormatForVariableType(definition.type === "dateTime" ? "dateTime" : "date");

  if (typeof value === "string" && value.trim()) {
    const parsed = parseDateValue(value);
    if (parsed) {
      return formatWithPattern(parsed, format).length + DATE_CONTROL_OVERHEAD_CH;
    }
  }

  const placeholderWidth = `Pick ${label.toLowerCase()}`.length;
  const formattedWidth = dateFormatDisplayWidthCh(format);

  return Math.max(placeholderWidth, formattedWidth) + DATE_CONTROL_OVERHEAD_CH;
}

function contentWidthCh(definition: TemplateVariableDefinition, value?: VariableFieldValue): number | undefined {
  const label = variableLabel(definition);

  if (definition.type === "boolean") {
    return booleanContentWidthCh(definition.format);
  }

  if (definition.type === "date" || definition.type === "dateTime") {
    return dateContentWidthCh(definition, value);
  }

  if (definition.type === "enum") {
    const options = definition.options ?? [];
    const displayFormat = parseEnumDisplayFormat(definition.format, options);

    if (displayFormat === "radio") {
      return enumRadioContentWidthCh(options);
    }

    return enumSelectContentWidthCh(options, label);
  }

  return undefined;
}

export function usesFitContentWidth(definition: TemplateVariableDefinition): boolean {
  return (
    definition.type === "boolean" ||
    definition.type === "enum" ||
    definition.type === "date" ||
    definition.type === "dateTime"
  );
}

export function getVariableFieldLayoutStyle(
  definition: TemplateVariableDefinition,
  value?: VariableFieldValue
): CSSProperties | undefined {
  const contentCh = contentWidthCh(definition, value);
  if (contentCh === undefined) {
    return undefined;
  }

  if (definition.type === "date" || definition.type === "dateTime") {
    return {
      width: "fit-content",
      maxWidth: "100%"
    };
  }

  const labelCh = labelMinWidthCh(variableLabel(definition));

  return {
    minWidth: `${Math.max(labelCh, contentCh)}ch`,
    width: "fit-content",
    maxWidth: "100%"
  };
}

export function getVariableFieldLayoutClass(definition: TemplateVariableDefinition): string {
  if (definition.type === "multiEnum") {
    return "w-full";
  }

  if (usesFitContentWidth(definition)) {
    return "max-w-full shrink-0";
  }

  return "w-full min-w-0 sm:min-w-[11rem] sm:max-w-[32rem] sm:flex-1";
}
