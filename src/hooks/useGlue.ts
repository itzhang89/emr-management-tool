import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GlueGetTableRequest, GlueListRequest, GlueTableDetail, GlueUpdateTableRequest } from "@/types/domain";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { glueService } from "@/services/glueService";

function useActiveAccountId() {
  const activeAccount = useActiveAwsAccount();
  return activeAccount.data?.id;
}

export function useGlueDatabases() {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["glue-databases", accountId],
    queryFn: async () => {
      const databases = [];
      let nextToken: string | undefined;
      do {
        const page = await glueService.listDatabases({ accountId, nextToken, maxResults: 100 });
        databases.push(...page.databases);
        nextToken = page.nextToken;
      } while (nextToken);
      return databases;
    },
    enabled: Boolean(accountId)
  });
}

export function useGlueTables(databaseName?: string) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["glue-tables", accountId, databaseName],
    queryFn: async () => {
      const tables = [];
      let nextToken: string | undefined;
      do {
        const page = await glueService.listTables({
          accountId,
          databaseName,
          nextToken,
          maxResults: 100
        });
        tables.push(...page.tables);
        nextToken = page.nextToken;
      } while (nextToken);
      return tables;
    },
    enabled: Boolean(accountId && databaseName)
  });
}

export function useGlueTable(request?: GlueGetTableRequest) {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["glue-table", accountId, request?.databaseName, request?.tableName],
    queryFn: () =>
      glueService.getTable({
        accountId,
        databaseName: request!.databaseName,
        tableName: request!.tableName
      }),
    enabled: Boolean(accountId && request?.databaseName && request?.tableName)
  });
}

export function useUpdateGlueTable() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: GlueUpdateTableRequest) => glueService.updateTable({ ...request, accountId }),
    onSuccess: (table) => {
      queryClient.setQueryData(["glue-table", accountId, table.databaseName, table.name], table);
      void queryClient.invalidateQueries({ queryKey: ["glue-tables", accountId, table.databaseName] });
    }
  });
}

export function cloneGlueTableDetail(table: GlueTableDetail): GlueTableDetail {
  return {
    ...table,
    parameters: { ...table.parameters },
    columns: table.columns.map((column) => ({ ...column })),
    partitionKeys: table.partitionKeys.map((column) => ({ ...column })),
    serdeParameters: { ...table.serdeParameters }
  };
}

export type { GlueListRequest };
