import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/types/domain";

/**
 * Level one of the LLM Setting tree: which providers exist and which are on.
 * Selecting one drives the configuration column beside it.
 */
export function ProviderList({
  providers,
  selectedId,
  onSelect,
  onAdd
}: {
  providers: LlmProvider[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
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

      {providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No providers yet. Add one to configure an API endpoint and models.
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {providers.map((provider) => {
            const modelCount = provider.endpoints.reduce(
              (total, endpoint) => total + endpoint.models.length,
              0
            );
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => onSelect(provider.id)}
                aria-current={provider.id === selectedId}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                  provider.id === selectedId ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                  // A disabled provider is still listed, but reads as inactive:
                  // it stays configurable while being excluded from Chat.
                  !provider.enabled && "opacity-60"
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      provider.enabled ? "bg-green-500" : "bg-muted-foreground/40"
                    )}
                  />
                  <span className="truncate">{provider.name}</span>
                </span>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {modelCount}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
