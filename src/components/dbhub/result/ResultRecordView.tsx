import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatCell, type Row } from "./resultGridModel";

/**
 * One row, laid out as a form.
 *
 * A wide table truncates every long value to keep its columns on screen; this
 * is where one row gets the whole width, so the text that had to be cut is
 * readable without a tooltip. It is also the view that says which row it is —
 * a grid position is easy to lose once a column has been dragged into a
 * grouping.
 *
 * Navigation stays inside the loaded page, like sorting and the row count:
 * stepping past the last row would mean a round trip, and the footer's paging
 * is where round trips belong.
 */
export function ResultRecordView({
  columns,
  rows,
  index,
  onIndexChange
}: {
  columns: string[];
  rows: Row[];
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const t = useT();
  const row = rows[index];
  if (!row) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {t("Select a row in the grid to read it here.")}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={index <= 0}
          aria-label={t("Previous record")}
          onClick={() => onIndexChange(index - 1)}
        >
          <ChevronLeft className="size-3" />
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {t("Record {position} of {total}", { position: index + 1, total: rows.length })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={index >= rows.length - 1}
          aria-label={t("Next record")}
          onClick={() => onIndexChange(index + 1)}
        >
          <ChevronRight className="size-3" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-[10px]">
          <tbody>
            {columns.map((column) => {
              const { text, kind } = formatCell(row[column]);
              return (
                <tr key={column} className="border-b align-top">
                  {/* The name column is a header, not data — it stays put and
                      keeps the values from having to repeat it. */}
                  <th
                    scope="row"
                    className="w-40 max-w-40 border-r bg-muted/30 px-2 py-1 text-left font-medium break-words"
                  >
                    {column}
                  </th>
                  <td
                    className={cn(
                      "px-2 py-1 font-mono break-words whitespace-pre-wrap",
                      kind === "null" && "italic text-muted-foreground/70",
                      kind === "boolean" && "text-violet-600 dark:text-violet-400",
                      kind === "json" && "text-sky-700 dark:text-sky-400"
                    )}
                  >
                    {text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
