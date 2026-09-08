import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DbConnectionFlags,
  DbConnectionInput,
  DbConnectionUpdateInput,
  NetworkProfileInput
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
