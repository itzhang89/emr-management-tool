import { readRecentSearchHistory, rememberRecentSearch } from "./recentSearchHistory";

const storageKey = "emr-eks:logs-job-id-search-recent";

export function readLogsJobIdSearchHistory() {
  return readRecentSearchHistory(storageKey);
}

export function rememberLogsJobIdSearch(query: string) {
  return rememberRecentSearch(storageKey, query);
}
