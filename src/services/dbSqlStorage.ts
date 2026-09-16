import { createSqlQueryStore } from "./sqlQueryStorage";

/**
 * SQL history and favourites for JDBC connections.
 *
 * Scoped by connection, not by account: SQL is dialect-specific, and a query
 * written for MySQL usually will not run on Postgres. One list per account
 * would offer the user statements that cannot work where they are reading
 * them — and would leave "which connection was this for?" unanswerable.
 */
export const dbSqlStore = createSqlQueryStore("emr-eks:dbhub-sql");

/** The key one connection's list lives under. */
export function dbSqlScope(accountId: string, connectionId: string) {
  return `${accountId}:conn:${connectionId}`;
}
