import { useState } from "react";
import {
  AudioLines,
  ChevronDown,
  Eye,
  Lightbulb,
  Plus,
  RefreshCw,
  Settings2,
  Star,
  Trash2,
  Video,
  Wrench
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteLlmModel, useUpdateLlmModel } from "@/hooks/useLlmConfig";
import { groupBySeries } from "@/services/llmModelSeries";
import { cn } from "@/lib/utils";
import type { LlmModel, LlmModelCapabilities } from "@/types/domain";

/** Only the abilities a model has are shown, so a row reads as a summary. */
const CAPABILITY_ICONS: Array<{
  key: keyof LlmModelCapabilities;
  label: string;
  Icon: typeof Lightbulb;
}> = [
  { key: "reasoning", label: "Reasoning", Icon: Lightbulb },
  { key: "toolCalling", label: "Tool calling", Icon: Wrench },
  { key: "vision", label: "Vision", Icon: Eye },
  { key: "audio", label: "Audio", Icon: AudioLines },
  { key: "video", label: "Video", Icon: Video }
];

/**
 * The provider's models, grouped by the group label.
 *
 * Groups are collapsible because a synced gateway can contribute dozens of models
 * across a handful of families, and the flat list buries the two or three a user
 * actually picks between.
 */
export function ModelTree({
  models,
  onAddModel,
  onEditModel,
  onSyncModels,
  canSync,
  syncing
}: {
  models: LlmModel[];
  onAddModel: () => void;
  onEditModel: (model: LlmModel) => void;
  onSyncModels: () => void;
  canSync: boolean;
  syncing: boolean;
}) {
  const grouped = groupBySeries(models);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleGroup = (group: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
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
                <RefreshCw className={cn("mr-1.5 size-3.5", syncing && "animate-spin")} />
                {syncing ? "Fetching..." : "Fetch model list"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canSync
                ? "Fetch the model list from this provider"
                : "Add an API address and key to this provider first"}
            </TooltipContent>
          </Tooltip>
          <Button type="button" variant="ghost" size="sm" onClick={onAddModel} aria-label="Add model">
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      {models.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
          No models yet. Fetch the list this provider offers, or add one by name.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {grouped.map(([group, groupModels]) => (
            <div key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={!collapsed.has(group)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform",
                    collapsed.has(group) && "-rotate-90"
                  )}
                />
                <span className="font-medium">{group}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {groupModels.length}
                </Badge>
              </button>

              {!collapsed.has(group) && (
                <div className="divide-y border-t bg-muted/20">
                  {groupModels.map((model) => (
                    <ModelRow key={model.id} model={model} onEdit={() => onEditModel(model)} />
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

function ModelRow({ model, onEdit }: { model: LlmModel; onEdit: () => void }) {
  const updateModel = useUpdateLlmModel();
  const deleteModel = useDeleteLlmModel();

  return (
    <div className="flex items-center gap-2 py-1.5 pl-9 pr-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{model.modelId}</span>
      {model.displayName && (
        <span className="hidden truncate text-xs text-muted-foreground sm:block">{model.displayName}</span>
      )}

      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {CAPABILITY_ICONS.filter(({ key }) => model.capabilities[key]).map(({ key, label, Icon }) => (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <Icon aria-label={label} className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </span>

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
            className="size-7 shrink-0"
            aria-label={`Edit ${model.modelId}`}
            onClick={onEdit}
          >
            <Settings2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit capabilities and token limits</TooltipContent>
      </Tooltip>

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
        <TooltipContent>Remove from this provider</TooltipContent>
      </Tooltip>
    </div>
  );
}
