const SEMVER_CORE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function normalizeReleaseVersion(raw?: string) {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/, "");
}

export function assertReleaseVersion(raw?: string, { label = "release version" }: { label?: string } = {}) {
  const version = normalizeReleaseVersion(raw);
  if (!version || !SEMVER_CORE.test(version)) {
    throw new Error(`Invalid ${label}: ${raw ?? "(empty)"}. Expected a semver like v0.2.0 or 0.2.0.`);
  }
  return version;
}
