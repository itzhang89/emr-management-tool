import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DbConnectionFlags,
  DbConnectionInput,
  DbConnectionTestInput,
  DbConnectionUpdateInput,
  DbQueryRequest,
  NetworkProfileInput,
  NetworkProfileTestInput,
  SchemaObjectKind
} from "@/types/domain";
import { dbHubService } from "@/services/dbHubService";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";

/**
 * DBHub react-query hooks. Every query key carries the active AWS account id
 * so switching accounts re-fetches the other account's set (the Rust side
 * scopes everything to the active account; the key mirrors that so stale rows
 * of the previous account are never rendered while loading).
 */

export const DB_CONNECTIONS_QUERY_KEY = "dbhub-connections";
export const DB_PROFILES_QUERY_KEY = "dbhub-profiles";

export function useDbConnections() {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  return useQuery({
    queryKey: [DB_CONNECTIONS_QUERY_KEY, accountId],
    queryFn: dbHubService.listConnections,
    enabled: Boolean(accountId)
  });
}

export function useNetworkProfiles() {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  return useQuery({
    queryKey: [DB_PROFILES_QUERY_KEY, accountId],
    queryFn: dbHubService.listProfiles,
    enabled: Boolean(accountId)
  });
}

function useInvalidateDbHub() {
  const queryClient = useQueryClient();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  return () => {
    void queryClient.invalidateQueries({ queryKey: [DB_CONNECTIONS_QUERY_KEY, accountId] });
    void queryClient.invalidateQueries({ queryKey: [DB_PROFILES_QUERY_KEY, accountId] });
  };
}

export function useCreateDbConnection() {
  const invalidate = useInvalidateDbHub();
  return useMutation({
    mutationFn: (input: DbConnectionInput) => dbHubService.createConnection(input),
    onSuccess: invalidate
  });
}

export function useUpdateDbConnection() {
  const invalidate = useInvalidateDbHub();
  return useMutation({
    mutationFn: (input: DbConnectionUpdateInput) => dbHubService.updateConnection(input),
    onSuccess: invalidate
  });
}

export function useSetDbConnectionFlags() {
  const invalidate = useInvalidateDbHub();
  return useMutation({
    mutationFn: ({ connectionId, flags }: { connectionId: string; flags: DbConnectionFlags }) =>
      dbHubService.setConnectionFlags(connectionId, flags),
    onSuccess: invalidate
  });
}

export function useDeleteDbConnection() {
  const invalidate = useInvalidateDbHub();
  return useMutation({
    mutationFn: (connectionId: string) => dbHubService.deleteConnection(connectionId),
    onSuccess: invalidate
  });
}

export function useTestDbConnection() {
  return useMutation({
    mutationFn: (connectionId: string) => dbHubService.testConnection(connectionId)
  });
}

/**
 * Probe a connection the dialog has not saved. Nothing is written and no cache
 * is invalidated — a test leaves the list exactly as it found it.
 */
export function useTestDbConnectionDraft() {
  return useMutation({
    mutationFn: (input: DbConnectionTestInput) => dbHubService.testDraftConnection(input)
  });
}

export function useSaveNetworkProfile() {
  const invalidate = useInvalidateDbHub();
  return useMutation({
    mutationFn: (input: NetworkProfileInput) => dbHubService.saveProfile(input),
    onSuccess: invalidate
  });
}

export function useDeleteNetworkProfile() {
  const invalidate = useInvalidateDbHub();
  return useMutation({
    mutationFn: (profileId: string) => dbHubService.deleteProfile(profileId),
    onSuccess: invalidate
  });
}

export function useTestNetworkProfile() {
  return useMutation({
    mutationFn: (profileId: string) => dbHubService.testProfile(profileId)
  });
}

/**
 * Probe the transport the profile dialog is still editing. Writes nothing and
 * leaves the saved profile — and its stored secret — alone.
 */
export function useTestNetworkProfileDraft() {
  return useMutation({
    mutationFn: (input: NetworkProfileTestInput) => dbHubService.testDraftProfile(input)
  });
}

// --- Read-only query execution ----------------------------------------------

export function useRunDbQuery() {
  return useMutation({
    mutationFn: (request: DbQueryRequest) => dbHubService.runQuery(request)
  });
}

/**
 * Stop a run by the id it was started with. Not a mutation: nothing is
 * invalidated and an id that is no longer running is a no-op, not a failure.
 */
export function useCancelDbQuery() {
  return async (requestId: string) => {
    try {
      await dbHubService.cancelQuery(requestId);
    } catch {
      // The run finished first, or the app is shutting down. Either way there
      // is nothing left to stop and nothing worth telling the user.
    }
  };
}

/** Catalog tree: databases of the connection. */
export function useDbDatabases(connectionId?: string, active = true) {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  return useQuery({
    queryKey: ["dbhub-databases", accountId, connectionId],
    queryFn: () => dbHubService.listDatabases(connectionId!),
    enabled: Boolean(active && accountId && connectionId)
  });
}

/**
 * Catalog tree: schemas of one database. Engines whose schema *is* their
 * database — MySQL — answer with nothing, which is how the tree learns it has
 * no third level to show.
 */
export function useDbSchemas(connectionId?: string, database?: string, active = true) {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  return useQuery({
    queryKey: ["dbhub-schemas", accountId, connectionId, database],
    queryFn: () => dbHubService.listSchemas(connectionId!, database!),
    enabled: Boolean(active && accountId && connectionId && database)
  });
}

/**
 * Ask for the tree again, for real.
 *
 * The Rust side serves a same-day cache, so invalidating the WebView's copy
 * alone would re-run the query and get the same cached answer back — the
 * backend's copy has to go first. Then the refetch that follows finds nothing
 * and goes to the database.
 */
export function useRefreshDbCatalog(connectionId?: string) {
  const queryClient = useQueryClient();
  return async () => {
    if (connectionId) {
      try {
        await dbHubService.refreshCatalog(connectionId);
      } catch {
        // Nothing to invalidate it with; the refetch below is still worth
        // doing, and it will re-read whatever the backend does hold.
      }
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dbhub-databases"] }),
      queryClient.invalidateQueries({ queryKey: ["dbhub-schemas"] }),
      queryClient.invalidateQueries({ queryKey: ["dbhub-objects"] })
    ]);
  };
}

/**
 * Catalog tree: the objects of one schema, of the kinds asked for, read from
 * the database that names it.
 *
 * The kinds are part of the query key so changing what is shown refetches
 * rather than re-filtering a list that never held the newly-ticked kind.
 */
export function useDbObjects(
  connectionId?: string,
  database?: string,
  schema?: string,
  kinds: SchemaObjectKind[] = ["table"],
  active = true
) {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  return useQuery({
    queryKey: ["dbhub-objects", accountId, connectionId, database, schema, [...kinds].sort()],
    queryFn: () => dbHubService.listObjects(connectionId!, database!, schema!, kinds),
    // Nothing ticked is nothing to ask for — the tree says so itself rather
    // than sending a request whose answer could only be an empty list.
    enabled: Boolean(
      active && accountId && connectionId && database && schema !== undefined && kinds.length
    )
  });
}
