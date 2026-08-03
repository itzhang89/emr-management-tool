import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AwsAccountCredentialsInput,
  AwsAccountSummary,
  AwsAccountUpdateInput,
  AwsCredentialsInput,
  ImportAwsCliProfileRequest
} from "@/types/domain";
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

function invalidateAccountScopedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] });
  void queryClient.invalidateQueries({ queryKey: ["virtual-clusters"] });
  void queryClient.invalidateQueries({ queryKey: ["job-runs"] });
  void queryClient.invalidateQueries({ queryKey: ["job-run"] });
  void queryClient.invalidateQueries({ queryKey: ["s3-buckets"] });
  void queryClient.invalidateQueries({ queryKey: ["s3-objects"] });
  void queryClient.invalidateQueries({ queryKey: ["s3-text-object"] });
  void queryClient.invalidateQueries({ queryKey: ["jobConfigTemplates"] });
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

export function useLoadAwsCliProfile() {
  return useMutation({
    mutationFn: (profileName: string) => awsCredentialsService.loadCliProfile(profileName)
  });
}

export function useSetActiveAwsAccount() {
  const queryClient = useQueryClient();
  const resetAccountScopedSession = useSessionStore((state) => state.resetAccountScopedSession);

  return useMutation({
    mutationFn: (accountId: string) => awsCredentialsService.setActiveAccount(accountId),
    onSuccess: (activeAccount) => {
      queryClient.setQueryData<AwsAccountSummary[]>(["aws-accounts"], (accounts) => {
        if (!accounts) return [activeAccount];
        return accounts.map((account) => ({
          ...account,
          isActive: account.id === activeAccount.id
        }));
      });
      resetAccountScopedSession();
      invalidateAccountScopedQueries(queryClient);
    }
  });
}

export function useRenameAwsAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ accountId, name }: { accountId: string; name: string }) =>
      awsCredentialsService.renameAccount(accountId, name),
    onSuccess: (renamed) => {
      queryClient.setQueryData<AwsAccountSummary[]>(["aws-accounts"], (accounts) => {
        if (!accounts) return [renamed];
        return accounts.map((account) => (account.id === renamed.id ? { ...account, ...renamed } : account));
      });
      void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] });
    }
  });
}

export function useUpdateAwsAccount() {
  const queryClient = useQueryClient();
  const resetAccountScopedSession = useSessionStore((state) => state.resetAccountScopedSession);

  return useMutation({
    mutationFn: (account: AwsAccountUpdateInput) => awsCredentialsService.updateAccount(account),
    onSuccess: (updated, variables) => {
      const previous = queryClient
        .getQueryData<AwsAccountSummary[]>(["aws-accounts"])
        ?.find((account) => account.id === variables.accountId);
      const regionChanged = previous !== undefined && previous.region !== updated.region;

      queryClient.setQueryData<AwsAccountSummary[]>(["aws-accounts"], (accounts) => {
        if (!accounts) return [updated];
        return accounts.map((account) => (account.id === updated.id ? { ...account, ...updated } : account));
      });

      if (regionChanged && updated.isActive) {
        resetAccountScopedSession();
        invalidateAccountScopedQueries(queryClient);
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] });
      if (regionChanged || updated.isActive) {
        void queryClient.invalidateQueries({ queryKey: ["virtual-clusters"] });
      }
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

export function useTestAwsAccount() {
  return useMutation({
    mutationFn: awsCredentialsService.testAccountConnection
  });
}
