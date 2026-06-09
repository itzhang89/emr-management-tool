import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AwsCredentialsInput } from "@/types/domain";
import { awsCredentialsService } from "@/services/awsCredentialsService";

export function useAwsSettings() {
  return useQuery({
    queryKey: ["aws-settings"],
    queryFn: awsCredentialsService.getSettings
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
