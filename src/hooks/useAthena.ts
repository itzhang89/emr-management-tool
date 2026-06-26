import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  AthenaQueryExecutionRequest,
  AthenaQueryResultsRequest,
  ExportAthenaQueryCsvRequest,
  StartAthenaQueryRequest
} from "@/types/domain";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { athenaService } from "@/services/athenaService";

function useActiveAccountId() {
  const activeAccount = useActiveAwsAccount();
  return activeAccount.data?.id;
}

export function useAthenaWorkgroups() {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["athena-workgroups", accountId],
    queryFn: () => athenaService.listWorkgroups({ accountId }),
    enabled: Boolean(accountId)
  });
}

export function useAthenaQueryExecution(queryExecutionId?: string, poll = false) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["athena-query-execution", accountId, queryExecutionId],
    queryFn: () => athenaService.getQueryExecution({ accountId, queryExecutionId: queryExecutionId! }),
    enabled: Boolean(accountId && queryExecutionId),
    refetchInterval: (query) => {
      if (!poll) return false;
      const state = query.state.data?.state;
      return state === "QUEUED" || state === "RUNNING" ? 1000 : false;
    }
  });
}

export function useAthenaQueryResults(request?: AthenaQueryResultsRequest, enabled = false) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["athena-query-results", accountId, request?.queryExecutionId, request?.nextToken],
    queryFn: () => athenaService.getQueryResults({ ...request!, accountId }),
    enabled: Boolean(accountId && request?.queryExecutionId && enabled)
  });
}

export function useStartAthenaQuery() {
  const accountId = useActiveAccountId();

  return useMutation({
    mutationFn: (request: StartAthenaQueryRequest) => athenaService.startQuery({ ...request, accountId })
  });
}

export function useStopAthenaQuery() {
  const accountId = useActiveAccountId();

  return useMutation({
    mutationFn: (request: AthenaQueryExecutionRequest) => athenaService.stopQuery({ ...request, accountId })
  });
}

export function useExportAthenaQueryCsv() {
  const accountId = useActiveAccountId();

  return useMutation({
    mutationFn: (request: ExportAthenaQueryCsvRequest) => athenaService.exportQueryCsv({ ...request, accountId })
  });
}
