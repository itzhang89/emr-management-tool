import type {
  JobConfigTemplate,
  ResolvedJobPayload,
  SparkResourceConfig,
  StartJobRunRequest,
  TemplateResolveContext,
  TemplateVariableDefinition
} from "@/types/domain";
import { applyResourceOverride } from "@/services/resourceOverride";
import { defaultFormatForVariableType, formatWithPattern } from "@/services/dateFormat";

const VARIABLE_PATTERN = /\$\{([a-zA-Z0-9_]+)(?::([^}]+))?\}/g;
const EMR_JOB_NAME_PATTERN = /^[.\-_/#A-Za-z0-9]+$/;
const EMR_JOB_NAME_MESSAGE =
  "Job name can only contain letters, numbers, dot, hyphen, underscore, slash, or #. Replace spaces with hyphens or underscores.";

export function resolveTemplatePayload(
  template: JobConfigTemplate,
  context: TemplateResolveContext
): ResolvedJobPayload {
  const now = context.now ?? new Date();
  const variables = buildVariableMap(template, context, now);
  const resolved = replaceTemplateVariables(template.payloadTemplate, variables, now);
  return JSON.parse(resolved) as ResolvedJobPayload;
}

export function buildVariableMap(
  template: JobConfigTemplate,
  context: TemplateResolveContext,
  now: Date
): Record<string, string> {
  const variables: Record<string, string> = {
    template_name: context.templateName,
    virtualClusterId: context.virtualClusterId,
    submitUser: context.submitUser,
    date: formatWithPattern(now, defaultFormatForVariableType("date")),
    datetime: formatWithPattern(now, defaultFormatForVariableType("dateTime"))
  };

  for (const definition of template.customVariables) {
    const raw = context.customVariables[definition.name];
    if (raw === undefined || raw === null) {
      if (definition.defaultValue !== undefined) {
        variables[definition.name] = stringifyVariableValue(definition.defaultValue, definition, now);
      }
      continue;
    }
    variables[definition.name] = stringifyVariableValue(raw, definition, now);
  }

  return variables;
}

export function replaceTemplateVariables(
  input: string,
  variables: Record<string, string>,
  now: Date
): string {
  return input.replace(VARIABLE_PATTERN, (_match, key: string, pattern?: string) => {
    if (key === "date" || key === "datetime") {
      return formatWithPattern(now, pattern ?? defaultFormatForVariableType(key === "date" ? "date" : "dateTime"));
    }
    if (pattern && variables[key]) {
      const parsed = new Date(variables[key]);
      if (!Number.isNaN(parsed.getTime())) {
        return formatWithPattern(parsed, pattern);
      }
    }
    return variables[key] ?? "";
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
    const value = customVariableValues[definition.name];
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
    return String(Boolean(value));
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
  const values: Record<string, string | number | boolean | string[]> = {};
  for (const definition of template.customVariables) {
    if (definition.defaultValue !== undefined) {
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
