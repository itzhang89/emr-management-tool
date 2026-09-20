import { AlignLeft, Rows3, Table2 } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ResultView } from "@/services/dbWorkspaceCache";

/**
 * The three ways one result can be read, as a rail down the left edge.
 *
 * Vertical because the labels are words, not glyphs — "Record" set sideways
 * costs eleven pixels of width where a horizontal strip of three would cost a
 * hundred, and the grid wants that width more than the switcher does.
 *
 * `<button role="tab">` rather than a segmented control: these really are
 * three views of one thing, and the arrow keys move between them.
 */

const VIEWS: Array<{ view: ResultView; label: string; icon: typeof Table2 }> = [
  { view: "grid", label: "Grid", icon: Table2 },
  { view: "text", label: "Text", icon: AlignLeft },
  { view: "record", label: "Record", icon: Rows3 }
];

export function ResultViewRail({
  view,
  onChange,
  recordDisabled
}: {
  view: ResultView;
  onChange: (view: ResultView) => void;
  /** Record shows one row — with none selected there is nothing to show. */
  recordDisabled?: boolean;
}) {
  const t = useT();

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      className="flex w-6 shrink-0 flex-col items-center gap-0.5 border-r bg-muted/20 py-1"
    >
      {VIEWS.map(({ view: entry, label, icon: Icon }) => {
        const active = view === entry;
        const disabled = entry === "record" && recordDisabled;
        return (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            title={t(label)}
            onClick={() => onChange(entry)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-sm px-0.5 py-1 text-[9px] transition-colors",
              active
                ? "bg-primary/10 font-semibold text-primary ring-1 ring-primary/30"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
            )}
          >
            <Icon className="size-3" />
            <span className="[writing-mode:vertical-rl]">{t(label)}</span>
          </button>
        );
      })}
    </div>
  );
}
