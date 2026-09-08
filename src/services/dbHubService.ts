import { tauriClient } from "@/services/tauriClient";
import type {
  DbConnection,
  DbConnectionFlags,
  DbConnectionInput,
  DbConnectionUpdateInput,
  NetworkProfile,
  NetworkProfileInput
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
  listProfiles: () => tauriClient.listNetworkProfiles(),
  saveProfile: (input: NetworkProfileInput) => tauriClient.saveNetworkProfile(input),
  deleteProfile: (profileId: string) => tauriClient.deleteNetworkProfile(profileId),
  testProfile: (profileId: string) => tauriClient.testNetworkProfile(profileId)
};

export type DbHubService = typeof dbHubService;

export type { DbConnection, NetworkProfile };
