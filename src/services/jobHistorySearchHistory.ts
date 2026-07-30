import { normalizeEmrJobRunId } from "./emrJobId";

const storageKey = "emr-eks:job-history-search-recent";
export const JOB_HISTORY_SEARCH_HISTORY_LIMIT = 10;

function historyKey(query: string) {
  return normalizeEmrJobRunId(query).toLowerCase();
}

export function readJobHistorySearchHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function rememberJobHistorySearch(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return readJobHistorySearchHistory();
  const key = historyKey(trimmed);
  const next = [trimmed, ...readJobHistorySearchHistory().filter((item) => historyKey(item) !== key)].slice(
    0,
    JOB_HISTORY_SEARCH_HISTORY_LIMIT
  );
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Local storage can be unavailable in hardened browser contexts.
    }
  }
  return next;
}
