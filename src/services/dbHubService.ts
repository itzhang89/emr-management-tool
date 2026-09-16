import { tauriClient } from "@/services/tauriClient";
import type {
  DbConnection,
  DbConnectionFlags,
  DbConnectionInput,
  DbConnectionTestInput,
  DbConnectionUpdateInput,
  DbQueryRequest,
  NetworkProfile,
  NetworkProfileInput,
  NetworkProfileTestInput
} from "@/types/domain";

/**
 * Thin wrapper over the DBHub tauri commands. All of them are scoped to the
 * active AWS account inside Rust — the frontend never passes an accountId.
 */
export const dbHubService = {
  listConnections: () => tauriClient.listDbConnections(),
  createConnection: (input: DbConnectionInput) => tauriClient.createDbConnection(input),
  updateConnection: (input: DbConnectionUpdateInput) => tauriClient.updateDbConnection(input),
  setConnectionFlags: (connectionId: string, flags: DbConnectionFlags) =>
    tauriClient.setDbConnectionFlags(connectionId, flags),
  deleteConnection: (connectionId: string) => tauriClient.deleteDbConnection(connectionId),
  testConnection: (connectionId: string) => tauriClient.testDbConnection(connectionId),
  testDraftConnection: (input: DbConnectionTestInput) => tauriClient.testDbConnectionDraft(input),
  listProfiles: () => tauriClient.listNetworkProfiles(),
  saveProfile: (input: NetworkProfileInput) => tauriClient.saveNetworkProfile(input),
  deleteProfile: (profileId: string) => tauriClient.deleteNetworkProfile(profileId),
  testProfile: (profileId: string) => tauriClient.testNetworkProfile(profileId),
  testDraftProfile: (input: NetworkProfileTestInput) => tauriClient.testNetworkProfileDraft(input),
  runQuery: (request: DbQueryRequest) => tauriClient.runDbQuery(request),
  listDatabases: (connectionId: string) => tauriClient.listDbDatabases(connectionId),
  listTables: (connectionId: string, database: string) =>
    tauriClient.listDbTables(connectionId, database)
};

export type DbHubService = typeof dbHubService;

export type { DbConnection, NetworkProfile };
