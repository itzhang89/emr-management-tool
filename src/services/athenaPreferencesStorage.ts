import type { AthenaAccountPreferences } from "@/types/domain";

const storagePrefix = "emr-eks:athena-preferences";

function storageKey(accountId: string) {
  return `${storagePrefix}:${accountId}`;
}

export function readAthenaPreferences(accountId: string): AthenaAccountPreferences {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(accountId));
    if (!raw) return {};
    return JSON.parse(raw) as AthenaAccountPreferences;
  } catch {
    return {};
  }
}

export function writeAthenaPreferences(accountId: string, preferences: AthenaAccountPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(accountId), JSON.stringify(preferences));
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

export function mergeAthenaPreferences(accountId: string, patch: Partial<AthenaAccountPreferences>) {
  const next = { ...readAthenaPreferences(accountId), ...patch };
  writeAthenaPreferences(accountId, next);
  return next;
}
