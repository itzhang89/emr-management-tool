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

export interface AthenaWorkgroupOutputHints {
  managedResultsEnabled?: boolean;
  enforceConfiguration?: boolean;
  outputLocation?: string;
  sparkEnabled?: boolean;
}

export function isAthenaManagedResultsWorkgroup(workgroup: AthenaWorkgroupOutputHints | undefined): boolean {
  return Boolean(workgroup?.managedResultsEnabled);
}

/** Whether the user must configure a path (or workgroup already has one) before running a query. */
export function isAthenaOutputPathRequired(
  workgroup: AthenaWorkgroupOutputHints | undefined,
  effectiveOutputLocation: string
): boolean {
  if (isAthenaManagedResultsWorkgroup(workgroup)) {
    return false;
  }
  if (effectiveOutputLocation.trim()) {
    return false;
  }
  if (workgroup?.enforceConfiguration && workgroup.outputLocation?.trim()) {
    return false;
  }
  return !workgroup?.outputLocation?.trim();
}

/** Output location sent to StartQueryExecution — always pass user S3 path when set; backend decides usage. */
export function resolveAthenaQueryOutputLocation(effectiveOutputLocation: string): string | undefined {
  const path = effectiveOutputLocation.trim();
  return path || undefined;
}

/** Path shown in the query bar — always prefer the user-configured S3 path when set. */
export function displayAthenaResultsPath(
  workgroup: AthenaWorkgroupOutputHints | undefined,
  effectiveOutputLocation: string
): string {
  if (effectiveOutputLocation.trim()) {
    return effectiveOutputLocation;
  }
  if (!isAthenaManagedResultsWorkgroup(workgroup) && workgroup?.outputLocation?.trim()) {
    return workgroup.outputLocation;
  }
  return "";
}
