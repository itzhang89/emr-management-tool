import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import type {
  AddLlmModelsRequest,
  CreateLlmEndpointRequest,
  CreateLlmProviderRequest,
  UpdateLlmEndpointRequest,
  UpdateLlmModelRequest,
  UpdateLlmProviderRequest
} from "@/types/domain";

export const LLM_PROVIDERS_QUERY_KEY = ["llm-providers"] as const;

/**
 * The whole provider → endpoint → model tree in one query. It is a few dozen
 * rows at most, so every mutation just invalidates the lot rather than patching
 * the cache — simpler, and the tree is small enough that refetching is cheap.
 */
export function useLlmProviders() {
  return useQuery({
    queryKey: LLM_PROVIDERS_QUERY_KEY,
    queryFn: () => tauriClient.listLlmProviders()
  });
}

function useTreeMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LLM_PROVIDERS_QUERY_KEY });
    }
  });
}

export function useCreateLlmProvider() {
  return useTreeMutation((request: CreateLlmProviderRequest) => tauriClient.createLlmProvider(request));
}

export function useUpdateLlmProvider() {
  return useTreeMutation((request: UpdateLlmProviderRequest) => tauriClient.updateLlmProvider(request));
}

export function useDeleteLlmProvider() {
  return useTreeMutation((id: string) => tauriClient.deleteLlmProvider(id));
}

export function useCreateLlmEndpoint() {
  return useTreeMutation((request: CreateLlmEndpointRequest) => tauriClient.createLlmEndpoint(request));
}

export function useUpdateLlmEndpoint() {
  return useTreeMutation((request: UpdateLlmEndpointRequest) => tauriClient.updateLlmEndpoint(request));
}

export function useDeleteLlmEndpoint() {
  return useTreeMutation((id: string) => tauriClient.deleteLlmEndpoint(id));
}

export function useAddLlmModels() {
  return useTreeMutation((request: AddLlmModelsRequest) => tauriClient.addLlmModels(request));
}

export function useUpdateLlmModel() {
  return useTreeMutation((request: UpdateLlmModelRequest) => tauriClient.updateLlmModel(request));
}

export function useDeleteLlmModel() {
  return useTreeMutation((id: string) => tauriClient.deleteLlmModel(id));
}

/**
 * Connection test. Not a tree mutation: it changes nothing, and its result is
 * shown inline next to the endpoint form rather than cached.
 */
export function useTestLlmEndpoint() {
  return useMutation({
    mutationFn: (endpointId: string) => tauriClient.testLlmEndpoint(endpointId)
  });
}

/**
 * Fetches import candidates from the provider's /models. The result feeds the
 * import dialog's multi-select, so it is mutation-shaped (user-triggered, not
 * cached) even though it only reads.
 */
export function useSyncLlmModels() {
  return useMutation({
    mutationFn: (endpointId: string) => tauriClient.syncLlmModels(endpointId)
  });
}
