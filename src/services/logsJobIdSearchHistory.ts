import { readRecentSearchHistory, rememberRecentSearch } from "./recentSearchHistory";

const storagePrefix = "emr-eks:logs-job-id-search-recent";
const legacyStorageKey = storagePrefix;

export function logsJobIdSearchHistoryKey(accountId: string) {
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

export function readLogsJobIdSearchHistory(accountId: string) {
  discardLegacyGlobalHistory();
  return readRecentSearchHistory(logsJobIdSearchHistoryKey(accountId));
}

export function rememberLogsJobIdSearch(accountId: string, query: string) {
  discardLegacyGlobalHistory();
  return rememberRecentSearch(logsJobIdSearchHistoryKey(accountId), query);
}
