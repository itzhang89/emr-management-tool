import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import type {
  AddLlmApiKeyRequest,
  AddLlmModelsRequest,
  CreateLlmProviderRequest,
  DuplicateLlmProviderRequest,
  SetLlmProviderHeadersRequest,
  UpdateLlmApiKeyRequest,
  UpdateLlmModelRequest,
  UpdateLlmProviderRequest
} from "@/types/domain";

export const LLM_PROVIDERS_QUERY_KEY = ["llm-providers"] as const;

/**
 * The whole provider → model tree in one query. It is a few dozen rows at most,
 * so every mutation just invalidates the lot rather than patching the cache —
 * simpler, and the tree is small enough that refetching is cheap.
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

export function useDuplicateLlmProvider() {
  return useTreeMutation((request: DuplicateLlmProviderRequest) =>
    tauriClient.duplicateLlmProvider(request)
  );
}

export function useDeleteLlmProvider() {
  return useTreeMutation((id: string) => tauriClient.deleteLlmProvider(id));
}

/** Header names live on the provider, so the tree is refetched after a change. */
export function useSetLlmProviderHeaders() {
  return useTreeMutation((request: SetLlmProviderHeadersRequest) =>
    tauriClient.setLlmProviderHeaders(request)
  );
}

export function useAddLlmApiKey() {
  return useTreeMutation((request: AddLlmApiKeyRequest) => tauriClient.addLlmApiKey(request));
}

export function useUpdateLlmApiKey() {
  return useTreeMutation((request: UpdateLlmApiKeyRequest) => tauriClient.updateLlmApiKey(request));
}

export function useDeleteLlmApiKey() {
  return useTreeMutation((id: string) => tauriClient.deleteLlmApiKey(id));
}

/**
 * Probes every key on a provider. A tree mutation, unlike the connection test:
 * it writes each key's health back to the database, so the cached tree is stale
 * once it returns.
 */
export function useProbeLlmApiKeys() {
  return useTreeMutation((providerId: string) => tauriClient.probeLlmApiKeys(providerId));
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
 * Connection test. Not a tree mutation: its result is shown inline next to the
 * provider form rather than cached.
 */
export function useTestLlmProvider() {
  return useMutation({
    mutationFn: (providerId: string) => tauriClient.testLlmProvider(providerId)
  });
}

/**
 * Fetches import candidates from the provider's /models. The result feeds the
 * import dialog's multi-select, so it is mutation-shaped (user-triggered, not
 * cached) even though it only reads.
 */
export function useSyncLlmModels() {
  return useMutation({
    mutationFn: (providerId: string) => tauriClient.syncLlmModels(providerId)
  });
}
