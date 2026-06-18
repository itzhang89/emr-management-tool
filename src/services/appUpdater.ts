import { check as checkTauriUpdate } from "@tauri-apps/plugin-updater";
import { getReleaseInfo } from "./releaseInfo";

export interface UpdaterDependency {
  canUseAutoUpdater: boolean;
  check: () => Promise<UpdateHandle | null>;
}

export interface UpdateHandle {
  version: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
}

export type UpdateCheckResult =
  | { status: "unavailable"; reason: string }
  | { status: "no-update" }
  | { status: "available"; version: string; notes?: string; install: () => Promise<void> };

export function createAppUpdater({ canUseAutoUpdater, check }: UpdaterDependency) {
  return {
    async checkForUpdate(): Promise<UpdateCheckResult> {
      if (!canUseAutoUpdater) {
        return {
          status: "unavailable",
          reason: "Automatic updates are available only for stable Windows and macOS builds."
        };
      }

      const update = await check();
      if (!update) return { status: "no-update" };

      return {
        status: "available",
        version: update.version,
        notes: update.body,
        install: () => update.downloadAndInstall()
      };
    }
  };
}

export const appUpdater = createAppUpdater({
  canUseAutoUpdater: getReleaseInfo().canUseAutoUpdater,
  check: checkTauriUpdate
});
