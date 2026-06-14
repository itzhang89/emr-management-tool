import type { JobConfigTemplate } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const jobConfigTemplateService = {
  list: async () => (await tauriClient.listJobConfigTemplates()).jobConfigTemplates,
  create: (template: JobConfigTemplate) => tauriClient.createJobConfigTemplate(template),
  update: (template: JobConfigTemplate) => tauriClient.updateJobConfigTemplate(template),
  delete: (id: string) => tauriClient.deleteJobConfigTemplate({ id }),
  duplicate: (id: string) => tauriClient.duplicateJobConfigTemplate({ id })
};
