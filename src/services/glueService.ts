import { tauriClient } from "./tauriClient";
import type {
  GlueDatabaseDetail,
  GlueGetDatabaseRequest,
  GlueGetTableRequest,
  GlueListRequest,
  GlueListDatabasesResponse,
  GlueListTablesResponse,
  GlueTableDetail,
  GlueUpdateDatabaseRequest,
  GlueUpdateTableRequest
} from "@/types/domain";

export const glueService = {
  listDatabases: (request: GlueListRequest = {}) => tauriClient.listGlueDatabases(request),
  listTables: (request: GlueListRequest) => tauriClient.listGlueTables(request),
  getDatabase: (request: GlueGetDatabaseRequest) => tauriClient.getGlueDatabase(request),
  updateDatabase: (request: GlueUpdateDatabaseRequest) => tauriClient.updateGlueDatabase(request),
  getTable: (request: GlueGetTableRequest) => tauriClient.getGlueTable(request),
  updateTable: (request: GlueUpdateTableRequest) => tauriClient.updateGlueTable(request)
};

export type { GlueDatabaseDetail, GlueListDatabasesResponse, GlueListTablesResponse, GlueTableDetail };
