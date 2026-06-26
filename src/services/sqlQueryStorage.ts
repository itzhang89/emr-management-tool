import type { SqlFavoriteEntry, SqlHistoryEntry } from "@/types/domain";

const MAX_SQL_HISTORY = 20;
const historyPrefix = "emr-eks:athena-sql-history";
const favoritesPrefix = "emr-eks:athena-sql-favorites";

function historyKey(accountId: string) {
  return `${historyPrefix}:${accountId}`;
}

function favoritesKey(accountId: string) {
  return `${favoritesPrefix}:${accountId}`;
}

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

export function readSqlHistory(accountId: string): SqlHistoryEntry[] {
  return readJson<SqlHistoryEntry[]>(historyKey(accountId)) ?? [];
}

export function addSqlHistory(accountId: string, sql: string): SqlHistoryEntry[] {
  const trimmed = sql.trim();
  if (!trimmed) return readSqlHistory(accountId);

  const now = new Date().toISOString();
  const deduped = readSqlHistory(accountId).filter((entry) => entry.sql.trim() !== trimmed);
  const next: SqlHistoryEntry[] = [{ id: crypto.randomUUID(), sql: trimmed, submittedAt: now }, ...deduped].slice(
    0,
    MAX_SQL_HISTORY
  );
  writeJson(historyKey(accountId), next);
  return next;
}

export function readSqlFavorites(accountId: string): SqlFavoriteEntry[] {
  return readJson<SqlFavoriteEntry[]>(favoritesKey(accountId)) ?? [];
}

export function addSqlFavorite(accountId: string, name: string, sql: string): SqlFavoriteEntry[] {
  const trimmedName = name.trim();
  const trimmedSql = sql.trim();
  if (!trimmedName || !trimmedSql) return readSqlFavorites(accountId);

  const next: SqlFavoriteEntry[] = [
    { id: crypto.randomUUID(), name: trimmedName, sql: trimmedSql, createdAt: new Date().toISOString() },
    ...readSqlFavorites(accountId).filter((entry) => entry.sql.trim() !== trimmedSql)
  ];
  writeJson(favoritesKey(accountId), next);
  return next;
}

export function removeSqlFavorite(accountId: string, favoriteId: string): SqlFavoriteEntry[] {
  const next = readSqlFavorites(accountId).filter((entry) => entry.id !== favoriteId);
  writeJson(favoritesKey(accountId), next);
  return next;
}

export { MAX_SQL_HISTORY };
