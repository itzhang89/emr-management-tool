export function normalizeS3Path(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const withScheme = trimmed.startsWith("s3://") ? trimmed : `s3://${trimmed.replace(/^\/+/, "")}`;
  return withScheme.endsWith("/") ? withScheme : `${withScheme}/`;
}

export function resolveAthenaOutputLocation(basePath: string, submitUser: string, appendEnabled: boolean): string {
  const normalized = normalizeS3Path(basePath);
  if (!normalized || !appendEnabled) {
    return normalized;
  }

  const user = submitUser.trim();
  if (!user) {
    return normalized;
  }

  const withoutTrailingSlash = normalized.replace(/\/+$/, "");
  if (withoutTrailingSlash.endsWith(`/${user}`)) {
    return `${withoutTrailingSlash}/`;
  }

  return `${normalized}${user}/`;
}

export function hasSubmitUserSuffix(basePath: string, submitUser: string): boolean {
  const user = submitUser.trim();
  if (!user) return false;
  const normalized = normalizeS3Path(basePath).replace(/\/+$/, "");
  return normalized.endsWith(`/${user}`);
}
