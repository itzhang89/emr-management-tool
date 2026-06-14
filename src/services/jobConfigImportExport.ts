import type { JobConfigTemplate, TemplateVariableDefinition } from "@/types/domain";

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
  return {
    name: variable.name.trim(),
    type: variable.type,
    required: variable.required ?? false,
    defaultValue: variable.defaultValue,
    options: variable.options?.map((option) => option.trim()).filter(Boolean),
    format: variable.format?.trim() || undefined
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
