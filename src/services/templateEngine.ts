import type {
  JobConfigTemplate,
  ResolvedJobPayload,
  SparkResourceConfig,
  StartJobRunRequest,
  TemplateResolveContext,
  TemplateVariableDefinition
} from "@/types/domain";
import { applyResourceOverride } from "@/services/resourceOverride";
import { formatBooleanValue, parseBooleanOutputStyle } from "@/services/booleanVariable";
import { defaultFormatForVariableType, formatWithPattern } from "@/services/dateFormat";

export const BUILTIN_TEMPLATE_VARIABLES = [
  "template_name",
  "virtualClusterId",
  "submitUser",
  "AWS_USERNAME",
  "AWS_ACCOUNT_ID",
  "AWS_REGION",
  "date",
  "datetime"
] as const;

export type BuiltinTemplateVariable = (typeof BUILTIN_TEMPLATE_VARIABLES)[number];
export function isBuiltinTemplateVariable(name: string) {
  return BUILTIN_TEMPLATE_VARIABLES.some((builtin) => builtin === name);
}

export const TEMPLATE_VARIABLE_PATTERN = /\$\{([a-zA-Z0-9_]+)(?::([^}]+))?\}/g;
const EMR_JOB_NAME_PATTERN = /^[.\-_/#A-Za-z0-9]+$/;
const EMR_JOB_NAME_MESSAGE =
  "Job name can only contain letters, numbers, dot, hyphen, underscore, slash, or #. Replace spaces with hyphens or underscores.";

export class MissingTemplateVariablesError extends Error {
  constructor(readonly variables: string[]) {
    super(`Missing template variables: ${variables.join(", ")}.`);
  }
}

export function resolveTemplatePayload(
  template: JobConfigTemplate,
  context: TemplateResolveContext
): ResolvedJobPayload {
  const now = context.now ?? new Date();
  const variables = buildVariableMap(template, context, now);
  const missing = new Set<string>();
  const render = (value: string) => replaceTemplateVariables(value, variables, now, (name) => missing.add(name));
  const resolveNode = (value: unknown): unknown => {
    if (typeof value === "string") return render(value);
    if (Array.isArray(value)) return value.map(resolveNode);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [render(key), resolveNode(entry)]));
    }
    return value;
  };
  const payload = resolveNode(JSON.parse(template.payloadTemplate));
  if (missing.size) throw new MissingTemplateVariablesError([...missing]);
  return payload as ResolvedJobPayload;
}

export function getBuiltinTemplateVariableValues(
  templateName: string | undefined,
  { virtualClusterId, submitUser, account }: Pick<TemplateResolveContext, "virtualClusterId" | "submitUser" | "account">,
  now: Date
): Record<BuiltinTemplateVariable, string | undefined> {
  const iamUserPath = account?.identity?.arn.match(/^arn:[^:]+:iam::\d{12}:user\/(.+)$/)?.[1];
  const roleAccountId = account?.roleArn?.match(/^arn:[^:]+:iam::(\d{12}):role\//)?.[1];
  return {
    template_name: templateName,
    virtualClusterId,
    submitUser,
    AWS_USERNAME: iamUserPath?.split("/").at(-1),
    AWS_ACCOUNT_ID: account?.identity?.account || account?.ssoAccountId || roleAccountId,
    AWS_REGION: account?.region || undefined,
    date: formatWithPattern(now, defaultFormatForVariableType("date")),
    datetime: formatWithPattern(now, defaultFormatForVariableType("dateTime"))
  };
}

export function buildVariableMap(
  template: JobConfigTemplate,
  context: TemplateResolveContext,
  now: Date
): Record<string, string> {
  const variables: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(getBuiltinTemplateVariableValues(template.name, context, now))) {
    if (value !== undefined) variables[name] = value;
  }

  for (const definition of template.customVariables) {
    if (isBuiltinTemplateVariable(definition.name)) continue;
    const raw = Object.hasOwn(context.customVariables, definition.name)
      ? context.customVariables[definition.name]
      : undefined;
    const value = raw ?? definition.defaultValue;
    if (value !== undefined && value !== null) {
      variables[definition.name] = stringifyVariableValue(value, definition, now);
    } else if (!definition.required) {
      variables[definition.name] = "";
    }
  }
  for (const [name, { value }] of Object.entries(context.accountVariables ?? {})) {
    if (!isBuiltinTemplateVariable(name)) variables[name] = value;
  }

  return variables;
}

export function replaceTemplateVariables(
  input: string,
  variables: Record<string, string>,
  now: Date,
  onMissing: (name: string) => void = (name) => { throw new MissingTemplateVariablesError([name]); }
): string {
  return input.replace(TEMPLATE_VARIABLE_PATTERN, (_match, key: string, pattern?: string) => {
    if (key === "date" || key === "datetime") {
      return formatWithPattern(now, pattern ?? defaultFormatForVariableType(key === "date" ? "date" : "dateTime"));
    }
    if (!Object.hasOwn(variables, key)) {
      onMissing(key);
      return "";
    }
    const value = variables[key];
    if (pattern && value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return formatWithPattern(parsed, pattern);
      }
    }
    return value;
  });
}

export function validateSubmitPayload(
  payload: ResolvedJobPayload,
  customVariables: TemplateVariableDefinition[] = [],
  customVariableValues: Record<string, string | number | boolean | string[]> = {}
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!payload.name?.trim()) errors.push("Job name is required.");
  if (payload.name && payload.name.length > 64) errors.push("Job name must be 64 characters or fewer.");
  if (payload.name && !EMR_JOB_NAME_PATTERN.test(payload.name)) errors.push(EMR_JOB_NAME_MESSAGE);
  if (!payload.virtualClusterId?.trim()) errors.push("Virtual cluster is required.");
  if (!payload.executionRoleArn?.trim()) errors.push("Execution role ARN is required.");
  if (!payload.releaseLabel?.trim()) errors.push("Release label is required.");
  const entryPoint = payload.jobDriver?.sparkSubmitJobDriver?.entryPoint?.trim();
  if (!entryPoint) {
    errors.push("Spark entry point is required.");
  } else if (!entryPoint.startsWith("s3://")) {
    errors.push("Spark entry point must be an S3 URI.");
  }

  if (/\$\{[a-zA-Z0-9_]+(?::[^}]+)?\}/.test(JSON.stringify(payload))) {
    errors.push("Unresolved template variables remain in the payload.");
  }

  for (const definition of customVariables) {
    if (!definition.required) continue;
    const value = Object.hasOwn(customVariableValues, definition.name)
      ? customVariableValues[definition.name]
      : undefined;
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      errors.push(`${definition.label ?? definition.name} is required.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function toStartJobRunRequest(
  payload: ResolvedJobPayload,
  resources: SparkResourceConfig
): StartJobRunRequest {
  const overridden = applyResourceOverride(payload, resources);
  const sparkDriver = overridden.jobDriver.sparkSubmitJobDriver;
  const sparkConfig = extractSparkConfig(sparkDriver.sparkSubmitParameters ?? "");

  return {
    name: overridden.name,
    virtualClusterId: overridden.virtualClusterId,
    executionRoleArn: overridden.executionRoleArn,
    releaseLabel: overridden.releaseLabel,
    application: {
      type: "jar",
      jarPath: sparkDriver.entryPoint,
      mainClass: extractMainClass(sparkDriver.sparkSubmitParameters ?? "")
    },
    arguments: sparkDriver.entryPointArguments ?? [],
    resources,
    sparkConfig,
    jobDriver: {
      sparkSubmitJobDriver: {
        entryPoint: sparkDriver.entryPoint,
        entryPointArguments: sparkDriver.entryPointArguments ?? [],
        sparkSubmitParameters: sparkDriver.sparkSubmitParameters ?? ""
      }
    },
    configurationOverrides: overridden.configurationOverrides
  };
}

function extractMainClass(sparkSubmitParameters: string) {
  const match = sparkSubmitParameters.match(/--class\s+(\S+)/);
  return match?.[1] ?? "";
}

function extractSparkConfig(sparkSubmitParameters: string) {
  const config: Record<string, string> = {};
  const matches = sparkSubmitParameters.matchAll(/--conf\s+([^=\s]+)=([^\s]+)/g);
  for (const match of matches) {
    const [, key, value] = match;
    if (!key.startsWith("spark.driver.") && !key.startsWith("spark.executor.")) {
      config[key] = value;
    }
  }
  return config;
}

function stringifyVariableValue(
  value: string | number | boolean | string[],
  definition: TemplateVariableDefinition,
  now: Date
) {
  if (definition.type === "boolean") {
    return formatBooleanValue(Boolean(value), parseBooleanOutputStyle(definition.format));
  }
  if (definition.type === "multiEnum" && Array.isArray(value)) {
    return value.join(",");
  }
  if ((definition.type === "date" || definition.type === "dateTime") && typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return formatWithPattern(parsed, definition.format ?? defaultFormatForVariableType(definition.type));
    }
  }
  if (definition.type === "date" || definition.type === "dateTime") {
    return formatWithPattern(now, definition.format ?? defaultFormatForVariableType(definition.type));
  }
  return String(value);
}

export function getDefaultCustomVariableValues(template: JobConfigTemplate) {
  const values: Record<string, string | number | boolean | string[]> = Object.create(null);
  for (const definition of template.customVariables) {
    if (definition.defaultValue != null) {
      values[definition.name] = definition.defaultValue;
    } else if (definition.type === "boolean") {
      values[definition.name] = false;
    } else if (definition.type === "multiEnum") {
      values[definition.name] = [];
    } else if (definition.type === "number") {
      values[definition.name] = 0;
    } else {
      values[definition.name] = "";
    }
  }
  return values;
}
