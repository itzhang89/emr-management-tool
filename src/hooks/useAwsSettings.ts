import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AwsAccountCredentialsInput, AwsCredentialsInput, ImportAwsCliProfileRequest } from "@/types/domain";
import { awsCredentialsService } from "@/services/awsCredentialsService";
import { useSessionStore } from "@/stores/sessionStore";

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

export function useActiveAwsAccount() {
  const accounts = useAwsAccounts();
  return {
    ...accounts,
    data: accounts.data?.find((account) => account.isActive)
  };
}

export function useAwsCliProfiles() {
  return useQuery({
    queryKey: ["aws-cli-profiles"],
    queryFn: awsCredentialsService.listCliProfiles
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

export function useImportAwsCliProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: ImportAwsCliProfileRequest) => awsCredentialsService.importCliProfile(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["virtual-clusters"] });
    }
  });
}

export function useSetActiveAwsAccount() {
  const queryClient = useQueryClient();
  const resetAccountScopedSession = useSessionStore((state) => state.resetAccountScopedSession);

  return useMutation({
    mutationFn: (accountId: string) => awsCredentialsService.setActiveAccount(accountId),
    onSuccess: () => {
      resetAccountScopedSession();
      void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["virtual-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["job-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["job-run"] });
      void queryClient.invalidateQueries({ queryKey: ["s3-buckets"] });
      void queryClient.invalidateQueries({ queryKey: ["s3-objects"] });
      void queryClient.invalidateQueries({ queryKey: ["s3-text-object"] });
      void queryClient.invalidateQueries({ queryKey: ["jobConfigTemplates"] });
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
