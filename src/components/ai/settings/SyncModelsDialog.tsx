import { useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAddLlmModels } from "@/hooks/useLlmConfig";
import { useT } from "@/i18n";
import { groupBySeries } from "@/services/llmModelSeries";
import type { LlmModelCandidate } from "@/types/domain";

/**
 * Multi-select over what the provider's /models reported.
 *
 * Gateways routinely advertise hundreds of models, so nothing is imported until
 * the user picks — otherwise one sync would bury the two or three models they
 * actually use. Already-stored models are shown but not selectable: re-importing
 * them is a no-op, and leaving them out of the list would look like data loss.
 */
export function SyncModelsDialog({
  providerId,
  candidates,
  loading,
  open,
  onOpenChange
}: {
  providerId: string;
  candidates: LlmModelCandidate[];
  loading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const addModels = useAddLlmModels();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.modelId.toLowerCase().includes(needle) ||
        candidate.series.toLowerCase().includes(needle)
    );
  }, [candidates, filter]);

  const grouped = groupBySeries(visible);
  const selectableVisible = visible.filter((candidate) => !candidate.alreadyAdded);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((c) => selected.has(c.modelId));

  const toggle = (modelId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const candidate of selectableVisible) {
        if (allVisibleSelected) {
          next.delete(candidate.modelId);
        } else {
          next.add(candidate.modelId);
        }
      }
      return next;
    });
  };

  const submit = () => {
    const chosen = candidates.filter((candidate) => selected.has(candidate.modelId));
    if (chosen.length === 0) {
      toast.error("Select at least one model to import.");
      return;
    }

    addModels.mutate(
      {
        providerId,
        models: chosen.map((candidate) => ({
          modelId: candidate.modelId,
          series: candidate.series,
          displayName: candidate.displayName ?? undefined,
          // Carried through when the provider reported them, which only the
          // Gemini shape does; the others leave these for the edit dialog.
          contextWindow: candidate.contextWindow ?? undefined,
          maxInputTokens: candidate.maxInputTokens ?? undefined,
          maxOutputTokens: candidate.maxOutputTokens ?? undefined
        }))
      },
      {
        onSuccess: (added) => {
          toast.success(
            added === 1
              ? t("1 model imported")
              : t("{count} models imported", { count: added })
          );
          setSelected(new Set());
          onOpenChange(false);
        },
        onError: (error: Error) => toast.error(error.message || "Failed to import models")
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{t("Import models")}</DialogTitle>
          <DialogDescription>
            {loading
              ? t("Asking the provider what models it offers...")
              : t("{count} models reported. Pick the ones you want.", {
                  count: candidates.length
                })}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {t("Loading model list...")}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("Filter by model id or series")}
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleAllVisible}
                disabled={selectableVisible.length === 0}
                className="shrink-0"
              >
                {allVisibleSelected ? t("Clear") : t("Select all")}
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {grouped.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  {t("No models match that filter.")}
                </p>
              ) : (
                grouped.map(([series, seriesCandidates]) => (
                  <div key={series} className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {series}
                    </p>
                    {seriesCandidates.map((candidate) => (
                      <label
                        key={candidate.modelId}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={candidate.alreadyAdded || selected.has(candidate.modelId)}
                          disabled={candidate.alreadyAdded}
                          onCheckedChange={() => toggle(candidate.modelId)}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {candidate.modelId}
                        </span>
                        {candidate.alreadyAdded && (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {t("Added")}
                          </Badge>
                        )}
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={loading || addModels.isPending}>
            {addModels.isPending
              ? t("Importing...")
              : selected.size > 0
                ? t("Import {count}", { count: selected.size })
                : t("Import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
