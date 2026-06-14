import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobConfigTemplate } from "@/types/domain";
import { jobConfigTemplateService } from "@/services/jobConfigTemplateService";
import { tauriClient } from "@/services/tauriClient";

export function useJobConfigTemplates() {
  return useQuery({
    queryKey: ["jobConfigTemplates"],
    queryFn: jobConfigTemplateService.list
  });
}

export function useCreateJobConfigTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (template: JobConfigTemplate) => jobConfigTemplateService.create(template),
    onSuccess: (response) => queryClient.setQueryData(["jobConfigTemplates"], response)
  });
}

export function useUpdateJobConfigTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (template: JobConfigTemplate) => jobConfigTemplateService.update(template),
    onSuccess: (response) => queryClient.setQueryData(["jobConfigTemplates"], response)
  });
}

export function useDeleteJobConfigTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => jobConfigTemplateService.delete(id),
    onSuccess: (response) => queryClient.setQueryData(["jobConfigTemplates"], response)
  });
}

export function useDuplicateJobConfigTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => jobConfigTemplateService.duplicate(id),
    onSuccess: (response) => queryClient.setQueryData(["jobConfigTemplates"], response)
  });
}

export function useSubmitUser() {
  return useQuery({
    queryKey: ["submitUser"],
    queryFn: () => tauriClient.getSubmitUser(),
    staleTime: Number.POSITIVE_INFINITY
  });
}
