import { check as checkTauriUpdate } from "@tauri-apps/plugin-updater";
import { readAutoUpdatePreference } from "./autoUpdatePreferences";
import { getReleaseInfo } from "./releaseInfo";
import { tauriClient } from "./tauriClient";

export const UPDATE_CHECK_TIMEOUT_MS = 60_000;

export interface UpdaterDependency {
  canUseAutoUpdater: boolean;
  check: () => Promise<UpdateHandle | null>;
  /** Live check of the user preference to install updates automatically. Defaults to enabled. */
  isAutoUpdateEnabled?: () => boolean;
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

export type SilentUpdateResult = "skipped" | "no-update" | "installed" | "failed";

export async function checkPortableUpdate(client = tauriClient): Promise<UpdateHandle | null> {
  const update = await client.checkPortableUpdate();
  if (!update) return null;
  return {
    version: update.version,
    body: update.notes,
    downloadAndInstall: async () => {
      await client.installPortableUpdate(update);
    }
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Update check timed out")), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createAppUpdater({ canUseAutoUpdater, check, isAutoUpdateEnabled = () => true }: UpdaterDependency) {
  let silentUpdateAttempted = false;
  let silentUpdateInFlight = false;

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
    },

    async checkAndInstallSilently(options?: {
      onInstalled?: (version: string) => void;
    }): Promise<SilentUpdateResult> {
      if (!canUseAutoUpdater) return "skipped";
      if (!isAutoUpdateEnabled()) return "skipped";
      if (silentUpdateAttempted || silentUpdateInFlight) return "skipped";
      silentUpdateAttempted = true;
      silentUpdateInFlight = true;
      try {
        const update = await withTimeout(check(), UPDATE_CHECK_TIMEOUT_MS);
        if (!update) return "no-update";
        await update.downloadAndInstall();
        options?.onInstalled?.(update.version);
        return "installed";
      } catch {
        return "failed";
      } finally {
        silentUpdateInFlight = false;
      }
    }
  };
}

export function resolveUpdateChecker(releaseInfo = getReleaseInfo()) {
  return releaseInfo.isPortable ? () => checkPortableUpdate() : checkTauriUpdate;
}

export const appUpdater = createAppUpdater({
  canUseAutoUpdater: getReleaseInfo().canUseAutoUpdater,
  check: resolveUpdateChecker(),
  isAutoUpdateEnabled: readAutoUpdatePreference
});
