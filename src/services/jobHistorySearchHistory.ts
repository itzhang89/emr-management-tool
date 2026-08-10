import { RECENT_SEARCH_HISTORY_LIMIT, readRecentSearchHistory, rememberRecentSearch } from "./recentSearchHistory";

const storagePrefix = "emr-eks:job-history-search-recent";
const legacyStorageKey = storagePrefix;

/** @deprecated Use RECENT_SEARCH_HISTORY_LIMIT */
export const JOB_HISTORY_SEARCH_HISTORY_LIMIT = RECENT_SEARCH_HISTORY_LIMIT;

export function jobHistorySearchHistoryKey(accountId: string) {
  return `${storagePrefix}:${accountId}`;
}

function discardLegacyGlobalHistory() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(legacyStorageKey);
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function readJobHistorySearchHistory(accountId: string) {
  discardLegacyGlobalHistory();
  return readRecentSearchHistory(jobHistorySearchHistoryKey(accountId));
}

export function rememberJobHistorySearch(accountId: string, query: string) {
  discardLegacyGlobalHistory();
  return rememberRecentSearch(jobHistorySearchHistoryKey(accountId), query);
}
