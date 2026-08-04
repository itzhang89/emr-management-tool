import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_DATETIME_FORMAT,
  parseDateValue
} from "@/services/dateFormat";
import type { ResolvedJobPayload, TemplateVariableDefinition } from "@/types/domain";

const KEY_VALUE_ARGUMENT_PATTERN = /^([^=]+)=(.*)$/;
const BOOLEAN_PATTERN = /^(true|false)$/i;
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;

export function kebabFlagToCamelCase(flagName: string): string {
  const cleaned = flagName.replace(/^-+/, "").trim();
  if (!cleaned) return "arg";

  const camel = cleaned.replace(/-([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase());
  if (/^[0-9]/.test(camel)) {
    return `arg${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
  }
  return camel;
}

export function humanizeFlagLabel(flagName: string): string {
  const cleaned = flagName.replace(/^-+/, "").trim();
  if (!cleaned) return "Argument";
  return cleaned
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function inferEntryPointArgumentVariable(
  flagName: string,
  rawValue: string
): TemplateVariableDefinition {
  const name = kebabFlagToCamelCase(flagName);
  const label = humanizeFlagLabel(flagName);
  const trimmed = rawValue.trim();

  if (BOOLEAN_PATTERN.test(trimmed)) {
    return {
      name,
      label,
      type: "boolean",
      defaultValue: trimmed.toLowerCase() === "true",
      required: true
    };
  }

  if (NUMBER_PATTERN.test(trimmed)) {
    return {
      name,
      label,
      type: "number",
      defaultValue: Number(trimmed),
      required: true
    };
  }

  const parsedDate = parseDateValue(trimmed);
  if (parsedDate) {
    const hasTime = /\d{2}:\d{2}/.test(trimmed);
    return {
      name,
      label,
      type: hasTime ? "dateTime" : "date",
      format: hasTime ? DEFAULT_DATETIME_FORMAT : DEFAULT_DATE_FORMAT,
      defaultValue: trimmed,
      required: true
    };
  }

  return {
    name,
    label,
    type: "text",
    defaultValue: rawValue,
    required: true
  };
}

export function parameterizeEntryPointArguments(argumentsList: string[]): {
  arguments: string[];
  customVariables: TemplateVariableDefinition[];
} {
  const customVariables: TemplateVariableDefinition[] = [];
  const usedNames = new Set<string>();

  const nextUniqueName = (base: string) => {
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    let index = 2;
    while (usedNames.has(`${base}${index}`)) {
      index += 1;
    }
    const unique = `${base}${index}`;
    usedNames.add(unique);
    return unique;
  };

  const rewritten = argumentsList.map((argument) => {
    const match = argument.match(KEY_VALUE_ARGUMENT_PATTERN);
    if (!match) return argument;

    const [, key, rawValue] = match;
    const definition = inferEntryPointArgumentVariable(key, rawValue);
    definition.name = nextUniqueName(definition.name);
    customVariables.push(definition);
    return `${key}=\${${definition.name}}`;
  });

  return { arguments: rewritten, customVariables };
}

export function parameterizeSourcePayloadForTemplate(payload: ResolvedJobPayload): {
  payloadTemplate: string;
  customVariables: TemplateVariableDefinition[];
} {
  const next = JSON.parse(JSON.stringify(payload)) as ResolvedJobPayload;
  const entryPointArguments = next.jobDriver?.sparkSubmitJobDriver?.entryPointArguments ?? [];
  const { arguments: rewritten, customVariables } = parameterizeEntryPointArguments(entryPointArguments);

  if (!next.jobDriver) {
    next.jobDriver = {
      sparkSubmitJobDriver: {
        entryPoint: "",
        entryPointArguments: rewritten,
        sparkSubmitParameters: ""
      }
    };
  } else {
    next.jobDriver.sparkSubmitJobDriver.entryPointArguments = rewritten;
  }

  return {
    payloadTemplate: JSON.stringify(next, null, 2),
    customVariables
  };
}
