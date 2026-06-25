import type { CSSProperties } from "react";
import type { TemplateVariableDefinition } from "@/types/domain";
import { formatBooleanValue, parseBooleanOutputStyle } from "@/services/booleanVariable";
import { defaultFormatForVariableType } from "@/services/dateFormat";
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

const MIN_NUMBER_DIGITS_CH = 4;
const NUMBER_SHELL_PADDING_CH = 3;
const MIN_NUMBER_SHELL_WIDTH = "4.5rem";
const RADIO_OPTION_GAP_CH = 4;
const RADIO_OPTION_OVERHEAD_CH = 3;

function variableLabel(definition: TemplateVariableDefinition): string {
  return definition.label ?? definition.name;
}

function controlWidthCh(textLength: number, extraCh = 2): number {
  return Math.max(textLength, 1) + extraCh;
}

function shellStyleFromTextLength(textLength: number, extraCh = 3): CSSProperties {
  return {
    width: `${controlWidthCh(textLength, extraCh)}ch`,
    maxWidth: "100%"
  };
}

function maxTextLength(...candidates: string[]): number {
  return Math.max(1, ...candidates.map((candidate) => candidate.length));
}

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

export function getBooleanShellStyle(definition: TemplateVariableDefinition): CSSProperties {
  const style = parseBooleanOutputStyle(definition.format);
  const trueText = formatBooleanValue(true, style);
  const falseText = formatBooleanValue(false, style);

  return shellStyleFromTextLength(maxTextLength(trueText, falseText));
}

export function getNumberShellStyle(definition: TemplateVariableDefinition): CSSProperties {
  const defaultDigits =
    typeof definition.defaultValue === "number" && Number.isFinite(definition.defaultValue)
      ? String(Math.abs(definition.defaultValue)).length
      : 0;
  const digits = Math.max(MIN_NUMBER_DIGITS_CH, defaultDigits);
  const contentCh = digits + NUMBER_SHELL_PADDING_CH;

  return {
    width: `max(${MIN_NUMBER_SHELL_WIDTH}, ${contentCh}ch)`,
    maxWidth: "100%"
  };
}

export function getEnumSelectShellStyle(definition: TemplateVariableDefinition): CSSProperties {
  const label = variableLabel(definition);
  const options = definition.options ?? [];
  const placeholder = `Select ${label}`;
  const longestOption = options.reduce(
    (longest, option) => (option.length > longest.length ? option : longest),
    ""
  );

  return shellStyleFromTextLength(maxTextLength(placeholder, longestOption));
}

export function getDateShellStyle(definition: TemplateVariableDefinition): CSSProperties {
  const label = variableLabel(definition);
  const placeholder = `Pick ${label.toLowerCase()}`;
  const format =
    definition.format ??
    defaultFormatForVariableType(definition.type === "dateTime" ? "dateTime" : "date");

  return shellStyleFromTextLength(maxTextLength(placeholder, format));
}

export function getCompactVariableShellStyle(definition: TemplateVariableDefinition): CSSProperties | undefined {
  switch (definition.type) {
    case "boolean":
      return getBooleanShellStyle(definition);
    case "number":
      return getNumberShellStyle(definition);
    case "enum": {
      const displayFormat = parseEnumDisplayFormat(definition.format, definition.options ?? []);
      if (displayFormat === "radio") {
        return getRadioEnumShellStyle(definition.options ?? []);
      }
      return getEnumSelectShellStyle(definition);
    }
    case "date":
    case "dateTime":
      return getDateShellStyle(definition);
    default:
      return undefined;
  }
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
