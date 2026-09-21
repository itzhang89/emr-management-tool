import { AlignLeft, Rows3, Table2 } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ResultView } from "@/services/dbWorkspaceCache";

/**
 * The two ways one result can be read at the top of the rail, and the switch
 * that opens a panel under it at the foot.
 *
 * Grid and Text are a pair — a result is either laid out in columns or dumped
 * as text — so they share a tablist and exactly one of them is on.
 *
 * "Record" is not a third member of that pair, and the rail says so by the space
 * it puts between them. It does not choose how the rows are drawn; it opens a
 * panel *below* them showing one of them transposed. So it toggles on its own
 * and combines with either format — and it sits at the far end of the rail,
 * where DBeaver puts it too, because it belongs to the pane underneath rather
 * than to the one above. A tablist would have promised the user that picking
 * Record would turn Grid off.
 *
 * Vertical because the labels are words, not glyphs — "Record" set sideways
 * costs eleven pixels of width where a horizontal row of three would cost a
 * hundred, and the grid wants that width more than the switcher does.
 */

const FORMATS: Array<{ view: ResultView; label: string; icon: typeof Table2 }> = [
  { view: "grid", label: "Grid", icon: Table2 },
  { view: "text", label: "Text", icon: AlignLeft }
];

export function ResultViewRail({
  view,
  single,
  onChange,
  onSingleChange,
  recordDisabled
}: {
  view: ResultView;
  single: boolean;
  onChange: (view: ResultView) => void;
  onSingleChange: (single: boolean) => void;
  /** One record needs a record: with no rows loaded there is nothing to narrow to. */
  recordDisabled?: boolean;
}) {
  const t = useT();

  // The top of this rail is the top of the table beside it — the SQL and the
  // filter box are drawn above both now — so the first tab starts level with
  // the header row rather than a gutter below it.
  return (
    <div className="flex w-6 shrink-0 flex-col items-center gap-0.5 border-r bg-muted/20 pb-1">
      <div
        role="tablist"
        aria-orientation="vertical"
        className="flex flex-col items-center gap-0.5"
      >
        {FORMATS.map(({ view: entry, label, icon: Icon }) => {
          const active = view === entry;
          return (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={active}
              title={t(label)}
              onClick={() => onChange(entry)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-sm px-0.5 py-1 text-[9px] transition-colors",
                active
                  ? "bg-primary/10 font-semibold text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <Icon className="size-3" />
              <span className="[writing-mode:vertical-rl]">{t(label)}</span>
            </button>
          );
        })}
      </div>

      <span className="my-0.5 h-px w-4 bg-border" />

      <button
        type="button"
        aria-pressed={single}
        disabled={recordDisabled}
        title={t("Record")}
        onClick={() => onSingleChange(!single)}
        className={cn(
          // `mt-auto` is the whole point of the spacing: the Record switch
          // belongs to the pane below, so it is pushed to the far end of the
          // rail rather than sitting in the group the format tabs are in.
          "mt-auto mb-1 flex flex-col items-center gap-0.5 rounded-sm px-0.5 py-1 text-[9px] transition-colors",
          single
            ? "bg-primary/10 font-semibold text-primary ring-1 ring-primary/30"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          recordDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
        )}
      >
        <Rows3 className="size-3" />
        <span className="[writing-mode:vertical-rl]">{t("Record")}</span>
      </button>
    </div>
  );
}
