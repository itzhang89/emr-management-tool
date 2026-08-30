import { useState } from "react";
import { ChevronDown, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteLlmModel, useUpdateLlmModel } from "@/hooks/useLlmConfig";
import { groupBySeries } from "@/services/llmModelSeries";
import { cn } from "@/lib/utils";
import type { LlmModel } from "@/types/domain";

/**
 * Level three: the endpoint's models, grouped by series.
 *
 * Series are collapsible because a synced gateway can contribute dozens of
 * models across a handful of families, and the flat list buries the two or three
 * a user actually picks between.
 */
export function ModelTree({
  models,
  onAddModel,
  onSyncModels,
  canSync,
  syncing
}: {
  models: LlmModel[];
  onAddModel: () => void;
  onSyncModels: () => void;
  canSync: boolean;
  syncing: boolean;
}) {
  const grouped = groupBySeries(models);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleSeries = (series: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(series)) {
        next.delete(series);
      } else {
        next.add(series);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Models</p>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onSyncModels}
                disabled={!canSync || syncing}
              >
                {syncing ? "Syncing..." : "Sync"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canSync
                ? "Fetch the model list from this endpoint"
                : "Add an API key to this endpoint first"}
            </TooltipContent>
          </Tooltip>
          <Button type="button" variant="ghost" size="sm" onClick={onAddModel}>
            <Plus className="mr-1 size-3.5" />
            Add model
          </Button>
        </div>
      </div>

      {models.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
          No models yet. Sync to fetch what this endpoint offers, or add one by name.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {grouped.map(([series, seriesModels]) => (
            <div key={series}>
              <button
                type="button"
                onClick={() => toggleSeries(series)}
                aria-expanded={!collapsed.has(series)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform",
                    collapsed.has(series) && "-rotate-90"
                  )}
                />
                <span className="font-medium">{series}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {seriesModels.length}
                </Badge>
              </button>

              {!collapsed.has(series) && (
                <div className="divide-y border-t bg-muted/20">
                  {seriesModels.map((model) => (
                    <ModelRow key={model.id} model={model} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelRow({ model }: { model: LlmModel }) {
  const updateModel = useUpdateLlmModel();
  const deleteModel = useDeleteLlmModel();

  return (
    <div className="flex items-center gap-2 py-1.5 pl-9 pr-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{model.modelId}</span>
      {model.displayName && (
        <span className="hidden truncate text-xs text-muted-foreground sm:block">{model.displayName}</span>
      )}

      {model.isDefault ? (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          Default
        </Badge>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={`Make ${model.modelId} the default model`}
              disabled={updateModel.isPending}
              onClick={() =>
                updateModel.mutate(
                  { id: model.id, isDefault: true },
                  {
                    onSuccess: () => toast.success(`${model.modelId} is now the default`),
                    onError: (error: Error) => toast.error(error.message || "Failed to set the default")
                  }
                )
              }
            >
              <Star className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Use as the default model for new chats</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${model.modelId}`}
            disabled={deleteModel.isPending}
            onClick={() =>
              deleteModel.mutate(model.id, {
                onError: (error: Error) => toast.error(error.message || "Failed to remove the model")
              })
            }
          >
            <Trash2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove from this endpoint</TooltipContent>
      </Tooltip>
    </div>
  );
}
