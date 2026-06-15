export type AppChannel = "stable" | "test" | "mac-debug";
export type AppPlatform = "windows" | "darwin" | "linux" | "unknown";

export interface ReleaseInfoInput {
  appChannel?: string;
  platform?: string;
}

export interface ReleaseInfo {
  appChannel: AppChannel;
  platform: AppPlatform;
  channelLabel: "Stable" | "Test" | "Debug";
  isMacDebug: boolean;
  canUseAutoUpdater: boolean;
}

export function createReleaseInfo(input: ReleaseInfoInput = {}): ReleaseInfo {
  const appChannel = normalizeChannel(input.appChannel);
  const platform = normalizePlatform(input.platform);
  const isMacDebug = appChannel === "mac-debug" && platform === "darwin";

  return {
    appChannel,
    platform,
    channelLabel: appChannel === "mac-debug" ? "Debug" : appChannel === "test" ? "Test" : "Stable",
    isMacDebug,
    canUseAutoUpdater: appChannel === "stable" && platform === "windows"
  };
}

export function getReleaseInfo() {
  return createReleaseInfo({
    appChannel: import.meta.env.VITE_APP_CHANNEL,
    platform: import.meta.env.VITE_APP_PLATFORM
  });
}

function normalizeChannel(channel?: string): AppChannel {
  if (channel === "test" || channel === "mac-debug") return channel;
  return "stable";
}

function normalizePlatform(platform?: string): AppPlatform {
  if (platform === "windows" || platform === "darwin" || platform === "linux") return platform;
  return "unknown";
}
