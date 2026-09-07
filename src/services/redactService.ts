import type { RedactRule } from "@/types/domain";
import { tauriClient } from "./tauriClient";

/** IPC access to the configurable log desensitization rules. */
export const redactService = {
  getConfig: () => tauriClient.redactGetConfig(),
  save: (rules: RedactRule[]) => tauriClient.redactSaveConfig(rules),
  resetToDefaults: () => tauriClient.redactResetDefaults(),
  test: (text: string, rules: RedactRule[]) => tauriClient.redactTest(text, rules)
};
