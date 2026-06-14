import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobConfigTemplate } from "@/types/domain";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { jobConfigTemplateService } from "@/services/jobConfigTemplateService";
import { tauriClient } from "@/services/tauriClient";

function useActiveAccountId() {
  const activeAccount = useActiveAwsAccount();
  return activeAccount.data?.id;
}

export function useJobConfigTemplates() {
  const accountId = useActiveAccountId();

  return useQuery({
    queryKey: ["jobConfigTemplates", accountId],
    queryFn: jobConfigTemplateService.list,
    enabled: Boolean(accountId)
  });
}

export function useCreateJobConfigTemplate() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (template: JobConfigTemplate) => jobConfigTemplateService.create(template),
    onSuccess: (response) => queryClient.setQueryData(["jobConfigTemplates", accountId], response)
  });
}

export function useUpdateJobConfigTemplate() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (template: JobConfigTemplate) => jobConfigTemplateService.update(template),
    onSuccess: (response) => queryClient.setQueryData(["jobConfigTemplates", accountId], response)
  });
}

export function useDeleteJobConfigTemplate() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => jobConfigTemplateService.delete(id),
    onSuccess: (response) => queryClient.setQueryData(["jobConfigTemplates", accountId], response)
  });
}

export function useDuplicateJobConfigTemplate() {
  const accountId = useActiveAccountId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => jobConfigTemplateService.duplicate(id),
    onSuccess: (response) => queryClient.setQueryData(["jobConfigTemplates", accountId], response)
  });
}

export function useSubmitUser() {
  return useQuery({
    queryKey: ["submitUser"],
    queryFn: () => tauriClient.getSubmitUser(),
    staleTime: Number.POSITIVE_INFINITY
  });
}
