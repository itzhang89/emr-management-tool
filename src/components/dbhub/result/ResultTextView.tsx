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
 * It shows the page as it arrived — sorting and grouping are the grid's, and
 * applying them here would make the text disagree with the row count in the
 * footer without saying so.
 */
export function ResultTextView({ columns, rows }: { columns: string[]; rows: Row[] }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const text = toTsv(columns, rows);

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
          {t("Tab-separated · {count} rows on this page", { count: rows.length })}
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
