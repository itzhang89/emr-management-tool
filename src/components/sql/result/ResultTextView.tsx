import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { toTsv, type Row } from "./resultGridModel";

/**
 * The page as plain text.
 *
 * Tab-separated rather than padded into columns: this view exists to be
 * selected, copied and pasted somewhere else, and alignment that survives one
 * paste into a proportional font is not worth the padding it costs here.
 *
 * It shows the page as it arrived — sorting is the grid's, and applying it here
 * would make the text disagree with the row count in the footer without saying
 * so. One record at a time is the record panel's, which opens *under* this
 * rather than narrowing it, for the same reason.
 *
 * Filtering is the exception, because it is not an arrangement of the rows but
 * a choice of which ones: the text is what gets copied away, and a dump that
 * carried rows the user had filtered off screen would leave with them. `pageCount`
 * is how it says so — the rows drawn against the rows the page holds.
 */
export function ResultTextView({
  columns,
  rows,
  pageCount
}: {
  columns: string[];
  rows: Row[];
  /** Rows on the page, when the filters took some of them away. */
  pageCount?: number;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const text = toTsv(columns, rows);
  const narrowed = pageCount !== undefined && pageCount !== rows.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Long enough to read, short enough that a second copy is not blocked.
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the text is on screen and selectable
      // either way, so there is nothing to apologise for.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1">
        <span className="text-[10px] text-muted-foreground">
          {narrowed
            ? t("Tab-separated · {count} of {total} rows on this page", {
                count: rows.length,
                total: pageCount
              })
            : t("Tab-separated · {count} rows on this page", { count: rows.length })}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t("Copy as text")}
              onClick={() => void copy()}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(copied ? "Copied" : "Copy as text")}</TooltipContent>
        </Tooltip>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[10px] leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
