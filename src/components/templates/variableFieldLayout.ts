import type { CSSProperties } from "react";
import type { TemplateVariableDefinition } from "@/types/domain";
import { formatBooleanValue, parseBooleanOutputStyle } from "@/services/booleanVariable";
import { defaultFormatForVariableType, formatWithPattern, parseDateValue } from "@/services/dateFormat";
import { parseEnumDisplayFormat } from "@/services/enumVariable";

export const VARIABLE_FIELDS_CONTAINER_CLASS = "flex flex-wrap items-start gap-x-4 gap-y-4";

export const COMPACT_FIELD_WRAPPER_CLASS = "flex w-fit max-w-full flex-col items-start gap-2";

export const COMPACT_FIELD_WRAPPER_STYLE: CSSProperties = {
  width: "fit-content",
  maxWidth: "100%"
};

export const COMPACT_NUMBER_INPUT_CLASS =
  "w-full min-w-0 max-w-full px-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export const COMPACT_SELECT_TRIGGER_CLASS = "!w-full min-w-0 max-w-full !justify-start gap-2 px-3";

type VariableFieldValue = string | number | boolean | string[] | undefined;

function variableLabel(definition: TemplateVariableDefinition): string {
  return definition.label ?? definition.name;
}

function controlWidthCh(textLength: number, extraCh = 2): number {
  return Math.max(textLength, 1) + extraCh;
}

const RADIO_OPTION_GAP_CH = 4;
const RADIO_OPTION_OVERHEAD_CH = 3;

export function getRadioEnumShellStyle(options: string[]): CSSProperties {
  if (options.length === 0) {
    return { width: "fit-content", maxWidth: "100%" };
  }

  const contentCh =
    options.reduce((sum, option) => sum + option.length + RADIO_OPTION_OVERHEAD_CH, 0) +
    Math.max(options.length - 1, 0) * RADIO_OPTION_GAP_CH;

  return {
    width: `${contentCh}ch`,
    maxWidth: "100%"
  };
}

function dateDisplayText(definition: TemplateVariableDefinition, value?: VariableFieldValue): string {
  const label = variableLabel(definition);
  const format =
    definition.format ??
    defaultFormatForVariableType(definition.type === "dateTime" ? "dateTime" : "date");

  if (typeof value === "string" && value.trim()) {
    const parsed = parseDateValue(value);
    if (parsed) {
      return formatWithPattern(parsed, format);
    }
  }

  return `Pick ${label.toLowerCase()}`;
}

const MIN_NUMBER_DIGITS_CH = 4;
const NUMBER_SHELL_PADDING_CH = 3;
const MIN_NUMBER_SHELL_WIDTH = "4.5rem";

export function getNumberInputStyle(value?: VariableFieldValue): CSSProperties {
  const digits =
    typeof value === "number" && Number.isFinite(value) ? String(Math.abs(value)).length : MIN_NUMBER_DIGITS_CH;
  const contentCh = Math.max(digits, MIN_NUMBER_DIGITS_CH) + NUMBER_SHELL_PADDING_CH;

  return {
    width: `max(${MIN_NUMBER_SHELL_WIDTH}, ${contentCh}ch)`,
    maxWidth: "100%"
  };
}

export function getSelectControlStyle(displayText: string): CSSProperties {
  return {
    width: `${controlWidthCh(displayText.length, 3)}ch`,
    maxWidth: "100%"
  };
}

export function getBooleanControlStyle(format: string | undefined, checked: boolean): CSSProperties {
  const output = formatBooleanValue(checked, parseBooleanOutputStyle(format));

  return {
    width: `${controlWidthCh(output.length, 3)}ch`,
    maxWidth: "100%"
  };
}

export function getDateControlStyle(definition: TemplateVariableDefinition, value?: VariableFieldValue): CSSProperties {
  return getSelectControlStyle(dateDisplayText(definition, value));
}

export function getEnumControlStyle(
  definition: TemplateVariableDefinition,
  value?: VariableFieldValue
): CSSProperties | undefined {
  const options = definition.options ?? [];
  const displayFormat = parseEnumDisplayFormat(definition.format, options);

  if (displayFormat === "radio") {
    return undefined;
  }

  const label = variableLabel(definition);
  const selected = typeof value === "string" && value ? value : `Select ${label}`;

  return getSelectControlStyle(selected);
}

export function usesFitContentWidth(definition: TemplateVariableDefinition): boolean {
  return (
    definition.type === "boolean" ||
    definition.type === "number" ||
    definition.type === "enum" ||
    definition.type === "date" ||
    definition.type === "dateTime"
  );
}

export function getVariableFieldLayoutStyle(
  definition: TemplateVariableDefinition,
  _value?: VariableFieldValue
): CSSProperties | undefined {
  if (!usesFitContentWidth(definition)) {
    return undefined;
  }

  return COMPACT_FIELD_WRAPPER_STYLE;
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
