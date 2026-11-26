import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import type { AccountTemplateVariables } from "@/types/domain";

export function useAccountTemplateVariables(accountId: string | undefined) {
  return useQuery({
    queryKey: ["accountTemplateVariables", accountId],
    queryFn: () => tauriClient.listAccountTemplateVariables({ accountId: accountId! }),
    enabled: Boolean(accountId)
  });
}

export function useSaveAccountTemplateVariables(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: AccountTemplateVariables) =>
      tauriClient.saveAccountTemplateVariables({ accountId, variables }),
    onSuccess: async (variables) => {
      const queryKey = ["accountTemplateVariables", accountId];
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, variables);
    }
  });
}
