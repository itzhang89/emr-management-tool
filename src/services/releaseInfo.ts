export type AppChannel = "stable" | "development";
export type AppPlatform = "windows" | "darwin" | "linux" | "unknown";

export interface ReleaseInfoInput {
  appChannel?: string;
  platform?: string;
  version?: string;
}

export interface ReleaseInfo {
  appChannel: AppChannel;
  platform: AppPlatform;
  version: string;
  channelLabel: "Stable" | "Development";
  isDevelopment: boolean;
  canUseAutoUpdater: boolean;
}

export function createReleaseInfo(input: ReleaseInfoInput = {}): ReleaseInfo {
  const appChannel = normalizeChannel(input.appChannel);
  const platform = normalizePlatform(input.platform);
  const isDevelopment = appChannel === "development";

  return {
    appChannel,
    platform,
    version: normalizeVersion(input.version),
    channelLabel: isDevelopment ? "Development" : "Stable",
    isDevelopment,
    canUseAutoUpdater: appChannel === "stable" && (platform === "windows" || platform === "darwin")
  };
}

export function getReleaseInfo() {
  return createReleaseInfo({
    appChannel: import.meta.env.VITE_APP_CHANNEL,
    platform: import.meta.env.VITE_APP_PLATFORM,
    version: import.meta.env.VITE_APP_VERSION
  });
}

function normalizeVersion(version?: string) {
  if (version?.trim()) return version.trim();
  return "0.0.0-dev";
}

function normalizeChannel(channel?: string): AppChannel {
  if (channel === "development") return "development";
  return "stable";
}

function normalizePlatform(platform?: string): AppPlatform {
  if (platform === "windows" || platform === "darwin" || platform === "linux") return platform;
  return "unknown";
}
