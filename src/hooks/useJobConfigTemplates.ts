import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { jobConfigTemplateService } from "@/services/jobConfigTemplateService";
import { tauriClient } from "@/services/tauriClient";
import type { JobConfigTemplate } from "@/types/domain";

const templatesKey = ["jobConfigTemplates"] as const;

export function useJobConfigTemplates() {
  const accountId = useActiveAwsAccount().data?.id;
  return useQuery({
    queryKey: [...templatesKey, accountId],
    queryFn: () => jobConfigTemplateService.list(accountId!),
    enabled: Boolean(accountId)
  });
}

function useTemplateMutation<T>(mutate: (accountId: string, value: T) => Promise<JobConfigTemplate[]>) {
  const accountId = useActiveAwsAccount().data?.id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: T) => {
      if (!accountId) throw new Error("No active AWS account.");
      return mutate(accountId, value);
    },
    onSuccess: async () => {
      // Remove inactive snapshots so switching accounts cannot show stale sharing state.
      queryClient.removeQueries({ queryKey: templatesKey, type: "inactive" });
      await queryClient.invalidateQueries({ queryKey: templatesKey });
    }
  });
}

export function useCreateJobConfigTemplate() {
  return useTemplateMutation(jobConfigTemplateService.create);
}

export function useUpdateJobConfigTemplate() {
  return useTemplateMutation(jobConfigTemplateService.update);
}

export function useDeleteJobConfigTemplate() {
  return useTemplateMutation(jobConfigTemplateService.delete);
}

export function useDuplicateJobConfigTemplate() {
  return useTemplateMutation(jobConfigTemplateService.duplicate);
}

export function useSubmitUser() {
  return useQuery({
    queryKey: ["submitUser"],
    queryFn: () => tauriClient.getSubmitUser(),
    staleTime: Number.POSITIVE_INFINITY
  });
}
