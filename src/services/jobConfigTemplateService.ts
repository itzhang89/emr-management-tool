import type { JobConfigTemplate } from "@/types/domain";
import { tauriClient } from "./tauriClient";

type JobConfigTemplatesResponse = { jobConfigTemplates: JobConfigTemplate[] };

async function unwrapTemplates(response: JobConfigTemplatesResponse) {
  return response.jobConfigTemplates.map(normalizeJobConfigTemplate);
}

function normalizeJobConfigTemplate(template: JobConfigTemplate): JobConfigTemplate {
  return {
    ...template,
    customVariables: template.customVariables ?? []
  };
}

export const jobConfigTemplateService = {
  list: async () => unwrapTemplates(await tauriClient.listJobConfigTemplates()),
  create: async (template: JobConfigTemplate) =>
    unwrapTemplates((await tauriClient.createJobConfigTemplate(template)) as JobConfigTemplatesResponse),
  update: async (template: JobConfigTemplate) =>
    unwrapTemplates((await tauriClient.updateJobConfigTemplate(template)) as JobConfigTemplatesResponse),
  delete: async (id: string) =>
    unwrapTemplates((await tauriClient.deleteJobConfigTemplate({ id })) as JobConfigTemplatesResponse),
  duplicate: async (id: string) =>
    unwrapTemplates((await tauriClient.duplicateJobConfigTemplate({ id })) as JobConfigTemplatesResponse)
};
