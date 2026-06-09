import type { ApplicationTemplate, ResourceTemplate } from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const templateService = {
  listTemplates: () => tauriClient.listTemplates(),
  create: (template: ApplicationTemplate | ResourceTemplate) => tauriClient.createTemplate(template),
  update: (template: ApplicationTemplate | ResourceTemplate) => tauriClient.updateTemplate(template),
  delete: (id: string, type: "application" | "resource") => tauriClient.deleteTemplate({ id, type }),
  duplicate: (id: string, type: "application" | "resource") => tauriClient.duplicateTemplate({ id, type })
};
