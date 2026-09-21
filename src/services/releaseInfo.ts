export type AppChannel = "stable" | "beta" | "development";
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
  channelLabel: "Stable" | "Beta" | "Development";
  isDevelopment: boolean;
  canUseAutoUpdater: boolean;
}

export function createReleaseInfo(input: ReleaseInfoInput = {}): ReleaseInfo {
  const appChannel = normalizeChannel(input.appChannel);
  const platform = normalizePlatform(input.platform);
  const distribution = normalizeDistribution(input.distribution);
  const isPortable = distribution === "portable";
  const isDevelopment = appChannel === "development";
  const channelLabel = appChannel === "beta" ? "Beta" : isDevelopment ? "Development" : "Stable";

  return {
    appChannel,
    platform,
    version: normalizeVersion(input.version),
    distribution,
    isPortable,
    channelLabel,
    isDevelopment,
    // Development builds carry the Dev identity and a local credential store,
    // so a downloaded package (always the stable identity) must never replace
    // them. Stable and beta builds are both stable-identity packages and may
    // update; which channel they read is the user's preference, not this flag.
    canUseAutoUpdater:
      appChannel !== "development" &&
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
  if (channel === "development" || channel === "beta") return channel;
  return "stable";
}

function normalizePlatform(platform?: string): AppPlatform {
  if (platform === "windows" || platform === "darwin" || platform === "linux") return platform;
  return "unknown";
}

function normalizeDistribution(value?: string): AppDistribution {
  return value === "portable" ? "portable" : "installer";
}
