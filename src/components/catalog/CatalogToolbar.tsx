import { ArrowLeft, PanelLeftClose, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The catalogue toolbar every workspace shares: step back a level, filter what
 * is listed, refetch it, and get the panel out of the way.
 *
 * The buttons are optional by prop rather than by a `variant`, because that is
 * how the workspaces genuinely differ — one has a level to go back to and the
 * other may not, and a button that renders but does nothing is worse than one
 * that is absent.
 */
export function CatalogToolbar({
  backLabel,
  onBack,
  filter,
  onFilterChange,
  filterPlaceholder,
  onRefresh,
  refreshing,
  onCollapse,
  collapseShortcut
}: {
  /** The back button's accessible name; omitted → no back button. */
  backLabel?: string;
  onBack?: () => void;
  filter: string;
  onFilterChange: (value: string) => void;
  filterPlaceholder: string;
  onRefresh: () => void;
  refreshing: boolean;
  onCollapse?: () => void;
  collapseShortcut?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {backLabel && onBack ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
      ) : null}
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={filterPlaceholder}
          className="h-8 pl-7 text-xs"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-7"
        onClick={onRefresh}
        aria-label="Refresh catalog"
      >
        <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
      </Button>
      {onCollapse ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7"
              aria-label="Collapse catalog panel"
              onClick={onCollapse}
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Hide catalog{collapseShortcut ? ` · ${collapseShortcut}` : ""}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
