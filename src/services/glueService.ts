import { tauriClient } from "./tauriClient";
import type {
  GlueGetTableRequest,
  GlueListRequest,
  GlueListDatabasesResponse,
  GlueListTablesResponse,
  GlueTableDetail,
  GlueUpdateTableRequest
} from "@/types/domain";

export const glueService = {
  listDatabases: (request: GlueListRequest = {}) => tauriClient.listGlueDatabases(request),
  listTables: (request: GlueListRequest) => tauriClient.listGlueTables(request),
  getTable: (request: GlueGetTableRequest) => tauriClient.getGlueTable(request),
  updateTable: (request: GlueUpdateTableRequest) => tauriClient.updateGlueTable(request)
};

export type { GlueListDatabasesResponse, GlueListTablesResponse, GlueTableDetail };
