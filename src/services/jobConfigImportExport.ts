import type { JobConfigTemplate, TemplateVariableDefinition } from "@/types/domain";
import { defaultBooleanOutputStyle, describeBooleanVariable } from "@/services/booleanVariable";
import { defaultFormatForVariableType } from "@/services/dateFormat";
import { parseEnumDisplayFormat } from "@/services/enumVariable";

export type JobConfigTemplateExport = Pick<
  JobConfigTemplate,
  "name" | "description" | "payloadTemplate" | "customVariables" | "defaultResourceTemplateId"
>;

export function serializeJobConfigTemplate(template: JobConfigTemplateExport) {
  return JSON.stringify(template, null, 2);
}

export function parseImportedJobConfigTemplate(raw: string): JobConfigTemplateExport {
  const parsed = JSON.parse(raw) as Partial<JobConfigTemplateExport>;
  if (!parsed.name?.trim()) {
    throw new Error("Template name is required.");
  }
  if (!parsed.payloadTemplate?.trim()) {
    throw new Error("Payload JSON is required.");
  }
  JSON.parse(parsed.payloadTemplate);

  return {
    name: parsed.name.trim(),
    description: parsed.description?.trim() || undefined,
    payloadTemplate: parsed.payloadTemplate,
    customVariables: (parsed.customVariables ?? []).map(normalizeVariableDefinition),
    defaultResourceTemplateId: parsed.defaultResourceTemplateId || undefined
  };
}

function normalizeVariableDefinition(variable: TemplateVariableDefinition): TemplateVariableDefinition {
  const options = variable.options?.map((option) => option.trim()).filter(Boolean);
  const format =
    variable.type === "boolean"
      ? variable.format?.trim() || defaultBooleanOutputStyle()
      : variable.type === "enum"
        ? parseEnumDisplayFormat(variable.format, options ?? [])
        : variable.format?.trim() ||
          (variable.type === "date" || variable.type === "dateTime" ? defaultFormatForVariableType(variable.type) : undefined);

  return {
    name: variable.name.trim(),
    description:
      variable.type === "boolean" && !variable.description?.trim()
        ? describeBooleanVariable(format, variable.defaultValue as boolean | undefined)
        : variable.description?.trim() || undefined,
    type: variable.type,
    required: variable.required ?? true,
    defaultValue: variable.defaultValue,
    options,
    format
  };
}

export function buildImportedJobConfigTemplate(payload: JobConfigTemplateExport): JobConfigTemplate {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: payload.name.endsWith(" (Imported)") ? payload.name : `${payload.name} (Imported)`,
    description: payload.description,
    payloadTemplate: payload.payloadTemplate,
    customVariables: payload.customVariables,
    defaultResourceTemplateId: payload.defaultResourceTemplateId,
    builtIn: false,
    createdAt: now,
    updatedAt: now
  };
}
