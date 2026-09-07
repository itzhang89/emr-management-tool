import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RedactRule } from "@/types/domain";
import { redactService } from "@/services/redactService";

export const REDACT_QUERY_KEY = ["redact-config"] as const;

/** The persisted rule set. The panel keeps a working copy on top of this. */
export function useRedactConfig() {
  return useQuery({
    queryKey: REDACT_QUERY_KEY,
    queryFn: redactService.getConfig
  });
}

/** Commit the panel's whole working copy. The backend answers the authoritative
 * set (it assigns ids to brand-new custom rows), which replaces the cache. */
export function useSaveRedactConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: RedactRule[]) => redactService.save(rules),
    onSuccess: (config) => queryClient.setQueryData(REDACT_QUERY_KEY, config)
  });
}

export function useResetRedactConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => redactService.resetToDefaults(),
    onSuccess: (config) => queryClient.setQueryData(REDACT_QUERY_KEY, config)
  });
}

export function useTestRedactRules() {
  return useMutation({
    mutationFn: ({ text, rules }: { text: string; rules: RedactRule[] }) =>
      redactService.test(text, rules)
  });
}
