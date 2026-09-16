import type { SqlFavoriteEntry, SqlHistoryEntry } from "@/types/domain";

const MAX_SQL_HISTORY = 20;

/**
 * SQL history and favourites under one namespace.
 *
 * The rules — twenty entries, newest first, deduped by statement text — are
 * the same wherever SQL is typed; only the key differs. `scope` is whatever
 * separates one list from another: the Glue workspace scopes by AWS account,
 * a DBHub connection by account *and* connection.
 */
export function createSqlQueryStore(namespace: string) {
  const historyKey = (scope: string) => `${namespace}-history:${scope}`;
  const favoritesKey = (scope: string) => `${namespace}-favorites:${scope}`;

function readJson<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

  function readHistory(scope: string): SqlHistoryEntry[] {
    return readJson<SqlHistoryEntry[]>(historyKey(scope)) ?? [];
  }

  function addHistory(scope: string, sql: string): SqlHistoryEntry[] {
    const trimmed = sql.trim();
    if (!trimmed) return readHistory(scope);

    const now = new Date().toISOString();
    const deduped = readHistory(scope).filter((entry) => entry.sql.trim() !== trimmed);
    const next: SqlHistoryEntry[] = [
      { id: crypto.randomUUID(), sql: trimmed, submittedAt: now },
      ...deduped
    ].slice(0, MAX_SQL_HISTORY);
    writeJson(historyKey(scope), next);
    return next;
  }

  function readFavorites(scope: string): SqlFavoriteEntry[] {
    return readJson<SqlFavoriteEntry[]>(favoritesKey(scope)) ?? [];
  }

  function addFavorite(scope: string, name: string, sql: string): SqlFavoriteEntry[] {
    const trimmedName = name.trim();
    const trimmedSql = sql.trim();
    if (!trimmedName || !trimmedSql) return readFavorites(scope);

    const next: SqlFavoriteEntry[] = [
      { id: crypto.randomUUID(), name: trimmedName, sql: trimmedSql, createdAt: new Date().toISOString() },
      ...readFavorites(scope).filter((entry) => entry.sql.trim() !== trimmedSql)
    ];
    writeJson(favoritesKey(scope), next);
    return next;
  }

  function removeFavorite(scope: string, favoriteId: string): SqlFavoriteEntry[] {
    const next = readFavorites(scope).filter((entry) => entry.id !== favoriteId);
    writeJson(favoritesKey(scope), next);
    return next;
  }

  return { readHistory, addHistory, readFavorites, addFavorite, removeFavorite };
}

// The Glue workspace's own list, under the namespace it has always used.
const athenaStore = createSqlQueryStore("emr-eks:athena-sql");

export const readSqlHistory = athenaStore.readHistory;
export const addSqlHistory = athenaStore.addHistory;
export const readSqlFavorites = athenaStore.readFavorites;
export const addSqlFavorite = athenaStore.addFavorite;
export const removeSqlFavorite = athenaStore.removeFavorite;

export { MAX_SQL_HISTORY };
