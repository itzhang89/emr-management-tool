import { Copy, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/types/domain";

/**
 * Level one: which providers exist. Selecting one drives the configuration column
 * beside it.
 *
 * The dot reads as "usable in Chat": a provider that is switched off, or has no
 * key, cannot answer. It stays listed either way, because a preset waiting for a
 * key is the normal starting state.
 *
 * Each row carries its own duplicate and delete actions, revealed on hover at the
 * far right so the list reads as names until the pointer lands on one. Acting on a
 * row never changes the selection — duplicating or deleting a provider that is not
 * the one being configured is a row-level action.
 */
export function ProviderList({
  providers,
  selectedId,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete
}: {
  providers: LlmProvider[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: (provider: LlmProvider) => void;
  onDelete: (provider: LlmProvider) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Providers</p>
        <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
          <Plus className="mr-1 size-3.5" />
          Add
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {providers.map((provider) => {
          const active = provider.enabled && provider.apiKeys.length > 0;
          const isSelected = provider.id === selectedId;
          return (
            <div
              key={provider.id}
              className={cn(
                "group flex w-full items-center gap-0.5 rounded-md transition-colors",
                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(provider.id)}
                aria-current={isSelected}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                  !active && "opacity-60"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    active ? "bg-green-500" : "bg-muted-foreground/40"
                  )}
                />
                <span className="truncate">{provider.name}</span>
                <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                  {provider.models.length}
                </Badge>
              </button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Duplicate ${provider.name}`}
                    onClick={() => onDuplicate(provider)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Duplicate for another account or gateway</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Delete ${provider.name}`}
                    onClick={() => onDelete(provider)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete this provider</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
