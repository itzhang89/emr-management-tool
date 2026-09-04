import { useMemo, useState } from "react";
import { Check, Copy, Filter, Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/types/domain";

type EnabledFilter = "all" | "enabled" | "disabled";

const FILTER_OPTIONS: Array<{ value: EnabledFilter; label: string }> = [
  { value: "all", label: "All providers" },
  { value: "enabled", label: "Enabled only" },
  { value: "disabled", label: "Disabled only" }
];

/**
 * Level one: which providers exist. Selecting one drives the configuration column
 * beside it. Search narrows by name and the filter keeps only enabled or disabled
 * rows; both stay local to the list.
 *
 * The dot reads as "usable in Chat": a provider that is switched off, or has no
 * key, cannot answer. It stays listed either way, because a preset waiting for a
 * key is the normal starting state.
 *
 * Each row's right edge is its model count, always visible. Hovering reveals the
 * duplicate and delete actions in the reserved gap to its left — no layout shift
 * when they appear. Acting on a row never changes the selection.
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
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return providers.filter((provider) => {
      if (needle && !provider.name.toLowerCase().includes(needle)) return false;
      if (enabledFilter === "enabled" && !provider.enabled) return false;
      if (enabledFilter === "disabled" && provider.enabled) return false;
      return true;
    });
  }, [providers, query, enabledFilter]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search providers"
            aria-label="Search providers"
            className="h-8 w-full pl-6 pr-1 text-xs"
          />
        </div>
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Filter providers"
              aria-pressed={enabledFilter !== "all"}
              className="size-8 shrink-0"
            >
              <Filter
                className={cn("size-3.5", enabledFilter !== "all" && "text-foreground")}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-1">
            {FILTER_OPTIONS.map((option) => {
              const active = enabledFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setEnabledFilter(option.value);
                    setFilterOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Check className={cn("size-3.5", active ? "opacity-100" : "opacity-0")} />
                  {option.label}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {providers.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No providers yet.</p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">Nothing matches.</p>
        ) : (
          visible.map((provider) => {
            const usable = provider.enabled && provider.apiKeys.length > 0;
            const isSelected = provider.id === selectedId;
            return (
              <div
                key={provider.id}
                className={cn(
                  "group flex w-full items-center gap-1 rounded-md transition-colors",
                  isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(provider.id)}
                  aria-current={isSelected}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-2 pr-1 text-left text-sm transition-colors",
                    !usable && "opacity-60"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      usable ? "bg-green-500" : "bg-muted-foreground/40"
                    )}
                  />
                  <span className="truncate">{provider.name}</span>
                </button>

                {/* The two actions fade into a reserved gap left of the count, so
                    the count never moves and the name is cut at the same place. */}
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

                <Badge
                  variant="secondary"
                  className="shrink-0 text-[10px]"
                  aria-label={`${provider.name} models`}
                >
                  {provider.models.length}
                </Badge>
              </div>
            );
          })
        )}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={onAdd} className="shrink-0">
        <Plus className="mr-1.5 size-3.5" />
        Add provider
      </Button>
    </div>
  );
}
