import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { cellClass, formatCell, recordText, type Row } from "./resultGridModel";

/**
 * The panel under the grid: the selected row, read the other way round.
 *
 * A grid is the right shape for comparing rows and the wrong one for reading a
 * single row whose columns run off the right edge. Transposed — one field to a
 * line, the name down the left — the whole record fits whatever width there is,
 * which is why DBeaver opens this below the results rather than instead of
 * them.
 *
 * It is a panel, not a third format. It sits *under* the grid rather than
 * replacing it, so the row being read stays in view, in its place on the page,
 * while it is read — and clicking another row up there moves this panel to it.
 * That is also why it takes no part in sorting: sorting arranges the page, and
 * this shows one row of it.
 */
export function ResultRecordPanel({
  columns,
  row,
  index,
  total,
  onIndexChange
}: {
  columns: string[];
  row?: Row;
  /** Zero-based place within the loaded page. */
  index: number;
  total: number;
  onIndexChange: (index: number) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recordText(columns, row));
      setCopied(true);
      // Long enough to read, short enough that a second copy is not blocked.
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the values are on screen and
      // selectable either way, so there is nothing to apologise for.
    }
  };

  return (
    <div className="flex min-h-0 flex-[2] flex-col overflow-hidden border-t bg-muted/10">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 text-[10px] text-muted-foreground">
        <span>{t("Record {position} of {total}", { position: index + 1, total })}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-5"
                aria-label={t("Copy this record")}
                onClick={() => void copy()}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(copied ? "Copied" : "Copy this record")}</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5"
            disabled={index <= 0}
            aria-label={t("Previous record")}
            onClick={() => onIndexChange(index - 1)}
          >
            <ChevronLeft className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5"
            disabled={index >= total - 1}
            aria-label={t("Next record")}
            onClick={() => onIndexChange(index + 1)}
          >
            <ChevronRight className="size-3" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-[10px]">
          <tbody>
            {columns.map((column) => {
              const { text, kind } = formatCell(row?.[column]);
              return (
                <tr key={column} className="border-b">
                  <th
                    scope="row"
                    className="w-px border-r bg-muted/40 px-2 py-1 text-left align-top font-medium whitespace-nowrap"
                  >
                    {column}
                  </th>
                  {/* The whole value, wrapped rather than cut: this panel exists
                      because the grid could not show all of it. */}
                  <td title={text} className={cn("px-2 py-1 font-mono break-all", cellClass(kind))}>
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
