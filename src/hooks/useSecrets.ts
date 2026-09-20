import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { tauriClient } from "@/services/tauriClient";
import type { CreateSecretInput } from "@/types/domain";

export function useSecrets() {
  const account = useActiveAwsAccount();
  const accountId = account.data?.id;
  return useQuery({
    queryKey: ["secrets", accountId, account.data?.region],
    queryFn: () => tauriClient.listSecrets(),
    enabled: Boolean(accountId)
  });
}

export function useCreateSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateSecretInput) => tauriClient.createSecret(request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["secrets"] });
    }
  });
}

export function useDescribeSecret() {
  return useMutation({
    mutationFn: (secretId: string) => tauriClient.describeSecret(secretId)
  });
}

export function useGetSecretValue() {
  return useMutation({
    mutationFn: (secretId: string) => tauriClient.getSecretValue(secretId)
  });
}
