import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AwsAccountCredentialsInput, AwsCredentialsInput } from "@/types/domain";
import { awsCredentialsService } from "@/services/awsCredentialsService";

export function useAwsSettings() {
  return useQuery({
    queryKey: ["aws-settings"],
    queryFn: awsCredentialsService.getSettings
  });
}

export function useAwsAccounts() {
  return useQuery({
    queryKey: ["aws-accounts"],
    queryFn: awsCredentialsService.listAccounts
  });
}

export function useCreateAwsAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (account: AwsAccountCredentialsInput) => awsCredentialsService.createAccount(account),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["virtual-clusters"] });
    }
  });
}

export function useSetActiveAwsAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => awsCredentialsService.setActiveAccount(accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["virtual-clusters"] });
    }
  });
}

export function useDeleteAwsAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => awsCredentialsService.deleteAccount(accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["virtual-clusters"] });
    }
  });
}

export function useSaveAwsCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: AwsCredentialsInput) => awsCredentialsService.save(credentials),
    onSuccess: (settings) => queryClient.setQueryData(["aws-settings"], settings)
  });
}

export function useTestAwsCredentials() {
  return useMutation({
    mutationFn: (credentials: AwsCredentialsInput) => awsCredentialsService.testConnection(credentials)
  });
}
