import { RECENT_SEARCH_HISTORY_LIMIT, readRecentSearchHistory, rememberRecentSearch } from "./recentSearchHistory";

const storageKey = "emr-eks:job-history-search-recent";

/** @deprecated Use RECENT_SEARCH_HISTORY_LIMIT */
export const JOB_HISTORY_SEARCH_HISTORY_LIMIT = RECENT_SEARCH_HISTORY_LIMIT;

export function readJobHistorySearchHistory() {
  return readRecentSearchHistory(storageKey);
}

export function rememberJobHistorySearch(query: string) {
  return rememberRecentSearch(storageKey, query);
}
