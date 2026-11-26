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
  import: async (accountId: string, template: JobConfigTemplate) =>
    unwrapTemplates(await tauriClient.createJobConfigTemplate({ accountId, template, resolveImportName: true })),
  update: async (accountId: string, template: JobConfigTemplate) =>
    unwrapTemplates(await tauriClient.updateJobConfigTemplate({ accountId, template })),
  setScope: async (accountId: string, request: { id: string; scope: NonNullable<JobConfigTemplate["scope"]> }) =>
    unwrapTemplates(await tauriClient.setJobConfigTemplateScope({ accountId, ...request })),
  delete: async (accountId: string, id: string) =>
    unwrapTemplates(await tauriClient.deleteJobConfigTemplate({ accountId, id })),
  duplicate: async (accountId: string, id: string) =>
    unwrapTemplates(await tauriClient.duplicateJobConfigTemplate({ accountId, id }))
};
