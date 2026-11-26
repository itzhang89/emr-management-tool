import type { JobConfigTemplate } from "@/types/domain";
import { tauriClient } from "./tauriClient";

function unwrapTemplates(response: { jobConfigTemplates: JobConfigTemplate[] }) {
  return response.jobConfigTemplates.map((template) => ({
    ...template,
    scope: template.scope ?? "private",
    customVariables: template.customVariables ?? []
  }));
}

export const jobConfigTemplateService = {
  list: async (accountId: string) => unwrapTemplates(await tauriClient.listJobConfigTemplates({ accountId })),
  create: async (accountId: string, template: JobConfigTemplate) =>
    unwrapTemplates(await tauriClient.createJobConfigTemplate({ accountId, template })),
  update: async (accountId: string, template: JobConfigTemplate) =>
    unwrapTemplates(await tauriClient.updateJobConfigTemplate({ accountId, template })),
  delete: async (accountId: string, id: string) =>
    unwrapTemplates(await tauriClient.deleteJobConfigTemplate({ accountId, id })),
  duplicate: async (accountId: string, id: string) =>
    unwrapTemplates(await tauriClient.duplicateJobConfigTemplate({ accountId, id }))
};
