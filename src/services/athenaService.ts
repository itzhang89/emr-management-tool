import type {
  AthenaQueryExecutionRequest,
  AthenaQueryResultsRequest,
  AwsCommandContext,
  ExportAthenaQueryCsvRequest,
  StartAthenaQueryRequest
} from "@/types/domain";
import { tauriClient } from "./tauriClient";

export const athenaService = {
  listWorkgroups: (request: AwsCommandContext = {}) => tauriClient.listAthenaWorkgroups(request),
  startQuery: (request: StartAthenaQueryRequest) => tauriClient.startAthenaQuery(request),
  getQueryExecution: (request: AthenaQueryExecutionRequest) => tauriClient.getAthenaQueryExecution(request),
  getQueryResults: (request: AthenaQueryResultsRequest) => tauriClient.getAthenaQueryResults(request),
  stopQuery: (request: AthenaQueryExecutionRequest) => tauriClient.stopAthenaQuery(request),
  exportQueryCsv: (request: ExportAthenaQueryCsvRequest) => tauriClient.exportAthenaQueryCsv(request)
};
