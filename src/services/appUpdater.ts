import { readAutoUpdatePreference } from "./autoUpdatePreferences";
import { readBetaUpdatePreference } from "./updateChannelPreferences";
import { getReleaseInfo } from "./releaseInfo";
import { tauriClient } from "./tauriClient";
import type { UpdateChannel } from "@/types/domain";

export const UPDATE_CHECK_TIMEOUT_MS = 60_000;

export interface UpdaterDependency {
  canUseAutoUpdater: boolean;
  /** Live check of the channel to read, so opting in takes effect on the next check. */
  check: (channel: UpdateChannel) => Promise<UpdateHandle | null>;
  /** Live check of the user preference to install updates automatically. Defaults to enabled. */
  isAutoUpdateEnabled?: () => boolean;
  /** Live check of the beta opt-in. Defaults to off. */
  isBetaChannelEnabled?: () => boolean;
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

export async function checkPortableUpdate(
  channel: UpdateChannel,
  client = tauriClient
): Promise<UpdateHandle | null> {
  const update = await client.checkPortableUpdate(channel);
  if (!update) return null;
  return {
    version: update.version,
    body: update.notes,
    downloadAndInstall: async () => {
      await client.installPortableUpdate(update);
    }
  };
}

/**
 * Installer-channel check. Goes through Rust rather than the plugin's JS
 * `check()` because only the Rust builder can override the update endpoints,
 * which is what selecting a channel means.
 */
export async function checkAppUpdate(
  channel: UpdateChannel,
  client = tauriClient
): Promise<UpdateHandle | null> {
  const update = await client.checkAppUpdate(channel);
  if (!update) return null;
  return {
    version: update.version,
    body: update.notes,
    downloadAndInstall: async () => {
      await client.installAppUpdate(channel);
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

export function createAppUpdater({
  canUseAutoUpdater,
  check,
  isAutoUpdateEnabled = () => true,
  isBetaChannelEnabled = () => false
}: UpdaterDependency) {
  let silentUpdateAttempted = false;
  let silentUpdateInFlight = false;

  const resolveChannel = (): UpdateChannel => (isBetaChannelEnabled() ? "beta" : "stable");

  return {
    async checkForUpdate(): Promise<UpdateCheckResult> {
      if (!canUseAutoUpdater) {
        return {
          status: "unavailable",
          reason: "Automatic updates are available only for packaged Windows and macOS builds."
        };
      }

      const update = await check(resolveChannel());
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
        const update = await withTimeout(check(resolveChannel()), UPDATE_CHECK_TIMEOUT_MS);
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

export function resolveUpdateChecker(channel: UpdateChannel, releaseInfo = getReleaseInfo()) {
  return releaseInfo.isPortable
    ? () => checkPortableUpdate(channel)
    : () => checkAppUpdate(channel);
}

export const appUpdater = createAppUpdater({
  canUseAutoUpdater: getReleaseInfo().canUseAutoUpdater,
  check: (channel) => resolveUpdateChecker(channel)(),
  isAutoUpdateEnabled: readAutoUpdatePreference,
  isBetaChannelEnabled: readBetaUpdatePreference
});
