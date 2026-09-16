import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One row of a catalogue level — a database, a schema, a table.
 *
 * The trailing details button is optional in the strongest sense: a workspace
 * with no metadata to show passes no `onShowInfo` and gets no button, rather
 * than a disabled one inviting a click that goes nowhere.
 */
export function CatalogRow({
  name,
  icon,
  selected = false,
  emphasis = false,
  onSelect,
  infoLabel,
  infoTooltip,
  onShowInfo
}: {
  name: string;
  icon?: ReactNode;
  selected?: boolean;
  /** Heavier weight for the names that are containers rather than data. */
  emphasis?: boolean;
  onSelect: () => void;
  /** The button's accessible name; omitted → no details button. */
  infoLabel?: string;
  infoTooltip?: string;
  onShowInfo?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-1 px-1.5 py-0.5 hover:bg-accent",
        selected && "bg-primary/10 text-primary"
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1 text-left text-xs"
        onClick={onSelect}
      >
        {icon}
        <span className={cn("truncate", emphasis && "font-medium")}>{name}</span>
      </button>
      {onShowInfo ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={infoLabel}
              onClick={(event) => {
                event.stopPropagation();
                onShowInfo();
              }}
            >
              <Info className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{infoTooltip}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
