const storagePrefix = "emr-eks:submit-job-form";
const lastTemplatePrefix = "emr-eks:submit-job-last-template";

export interface SubmitJobFormCache {
  resourceTemplateId?: string;
  customVariables?: Record<string, string | number | boolean | string[]>;
}

function parseStoredFormCache(raw: string): SubmitJobFormCache | undefined {
  try {
    const parsed = JSON.parse(raw) as SubmitJobFormCache;
    if (parsed.resourceTemplateId !== undefined && typeof parsed.resourceTemplateId !== "string") {
      return undefined;
    }
    if (parsed.customVariables !== undefined && (typeof parsed.customVariables !== "object" || parsed.customVariables === null)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function submitJobFormStorageKey(accountId: string, templateId: string) {
  return `${storagePrefix}:${accountId}:${templateId}`;
}

export function submitJobLastTemplateStorageKey(accountId: string) {
  return `${lastTemplatePrefix}:${accountId}`;
}

export function readSubmitJobFormCache(accountId: string, templateId: string) {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = window.localStorage.getItem(submitJobFormStorageKey(accountId, templateId));
    if (!stored) return undefined;
    return parseStoredFormCache(stored);
  } catch {
    return undefined;
  }
}

export function writeSubmitJobFormCache(accountId: string, templateId: string, cache: SubmitJobFormCache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(submitJobFormStorageKey(accountId, templateId), JSON.stringify(cache));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function readSubmitJobLastTemplate(accountId: string) {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = window.localStorage.getItem(submitJobLastTemplateStorageKey(accountId));
    return stored?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function writeSubmitJobLastTemplate(accountId: string, templateId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(submitJobLastTemplateStorageKey(accountId), templateId);
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}
