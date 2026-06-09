import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApplicationTemplate, ResourceTemplate } from "@/types/domain";
import { templateService } from "@/services/templateService";

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: templateService.listTemplates
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (template: ApplicationTemplate | ResourceTemplate) => templateService.create(template),
    onSuccess: (templates) => queryClient.setQueryData(["templates"], templates)
  });
}

export function useDuplicateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: "application" | "resource" }) => templateService.duplicate(id, type),
    onSuccess: (templates) => queryClient.setQueryData(["templates"], templates)
  });
}
