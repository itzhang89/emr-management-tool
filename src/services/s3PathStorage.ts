const storagePrefix = "emr-eks:last-s3-path";
const legacyStorageKey = storagePrefix;

function parseStoredS3Path(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { bucket?: unknown; prefix?: unknown };
    if (typeof parsed.bucket !== "string" || !parsed.bucket.trim()) return undefined;
    return {
      bucket: parsed.bucket,
      prefix: typeof parsed.prefix === "string" ? parsed.prefix : ""
    };
  } catch {
    return undefined;
  }
}

export function s3PathStorageKey(accountId: string) {
  return `${storagePrefix}:${accountId}`;
}

export function readLastS3Path(accountId: string) {
  if (typeof window === "undefined") return undefined;
  try {
    const scoped = window.localStorage.getItem(s3PathStorageKey(accountId));
    if (scoped) {
      return parseStoredS3Path(scoped);
    }

    const legacy = window.localStorage.getItem(legacyStorageKey);
    if (!legacy) return undefined;

    const migrated = parseStoredS3Path(legacy);
    if (!migrated) return undefined;

    writeLastS3Path(accountId, migrated.bucket, migrated.prefix);
    window.localStorage.removeItem(legacyStorageKey);
    return migrated;
  } catch {
    return undefined;
  }
}

export function writeLastS3Path(accountId: string, bucket: string, prefix: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(s3PathStorageKey(accountId), JSON.stringify({ bucket, prefix }));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}
