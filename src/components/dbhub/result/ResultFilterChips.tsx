import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { CellFilter } from "@/services/dbWorkspaceCache";
import { filterLabel } from "./resultFilter";

/**
 * The conditions in force, one chip each, with the count of what they left.
 *
 * Drawn from the same list the grid filters by, which is read off the
 * expression in the box above — so this is a *reading* of that text, not a
 * second place the filter is kept. Taking a chip off rewrites the expression
 * without it, and the two go on agreeing.
 *
 * It exists because a filter that hides rows without saying so is the worst
 * thing this could do. The grid would simply have fewer rows in it, and the two
 * counts that would normally catch that out do not: the footer counts the page,
 * and the page has not changed. So the conditions are drawn where the rows are,
 * each with its own way out, and the count of what survived them is stated
 * beside them.
 *
 * It sits above both formats rather than inside the grid, because it is a fact
 * about the result and not about how the result is drawn — the text view drops
 * the same rows, and a strip that vanished when the user switched to it would
 * be the silence this exists to prevent.
 */
export function ResultFilterChips({
  filters,
  kept,
  total,
  onRemove,
  onClear
}: {
  filters: CellFilter[];
  /** Rows left after the filters; `total` is the page they were drawn from. */
  kept: number;
  total: number;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const t = useT();

  return (
    <div className="flex h-6 shrink-0 items-center gap-2 border-b bg-muted/30 px-2 text-[10px]">
      <span className="shrink-0 text-muted-foreground">
        {t("{kept} of {total} rows match", { kept, total })}
      </span>
      {/* The conditions scroll rather than wrap: this strip sits above the rows
          and a second line would move them every time one was added. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {filters.map((filter, index) => {
          const label = filterLabel(filter);
          return (
            <span
              // The label is the condition, and no two conditions are the same
              // — which is what the expression above them is asked to mean.
              key={label}
              className="flex shrink-0 items-center gap-1 rounded-sm border bg-background px-1 py-0.5 font-mono"
            >
              <span>{label}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label={`${t("Remove filter")}: ${label}`}
                onClick={() => onRemove(index)}
              >
                <X className="size-2.5" />
              </button>
            </span>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 px-1.5 text-[10px]"
        onClick={onClear}
      >
        {t("Clear all")}
      </Button>
    </div>
  );
}
