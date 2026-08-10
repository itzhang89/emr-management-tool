export type AppChannel = "stable" | "development";
export type AppPlatform = "windows" | "darwin" | "linux" | "unknown";
export type AppDistribution = "installer" | "portable";

export interface ReleaseInfoInput {
  appChannel?: string;
  platform?: string;
  version?: string;
  distribution?: string;
}

export interface ReleaseInfo {
  appChannel: AppChannel;
  platform: AppPlatform;
  version: string;
  distribution: AppDistribution;
  isPortable: boolean;
  channelLabel: "Stable" | "Development";
  isDevelopment: boolean;
  canUseAutoUpdater: boolean;
}

export function createReleaseInfo(input: ReleaseInfoInput = {}): ReleaseInfo {
  const appChannel = normalizeChannel(input.appChannel);
  const platform = normalizePlatform(input.platform);
  const distribution = normalizeDistribution(input.distribution);
  const isPortable = distribution === "portable";
  const isDevelopment = appChannel === "development";

  return {
    appChannel,
    platform,
    version: normalizeVersion(input.version),
    distribution,
    isPortable,
    channelLabel: isDevelopment ? "Development" : "Stable",
    isDevelopment,
    canUseAutoUpdater:
      appChannel === "stable" &&
      (isPortable ? platform === "windows" : platform === "windows" || platform === "darwin")
  };
}

export function getReleaseInfo() {
  return createReleaseInfo({
    appChannel: import.meta.env.VITE_APP_CHANNEL,
    platform: import.meta.env.VITE_APP_PLATFORM,
    version: import.meta.env.VITE_APP_VERSION,
    distribution: import.meta.env.VITE_APP_DISTRIBUTION
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

function normalizeDistribution(value?: string): AppDistribution {
  return value === "portable" ? "portable" : "installer";
}
