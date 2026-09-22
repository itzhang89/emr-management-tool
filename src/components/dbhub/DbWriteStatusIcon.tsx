import readOnlyIcon from "@/assets/status/read-only.svg";
import writableIcon from "@/assets/status/writable.svg";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Whether this connection may write, as the status set's own mark — a blue eye
 * for read-only, a green pencil for writable.
 *
 * This replaces the text badge it used to be, which is why the wording moved
 * into the tooltip rather than simply disappearing: the header has room for the
 * state, not for the sentence explaining it, and a hover is where a reader who
 * wants the sentence is already looking.
 *
 * The wrapper carries the state as its accessible name and takes focus, so the
 * explanation arrives for a keyboard reader too — hovering is not the only way
 * to ask. The `<img>` inside is decorative for the same reason the engine mark
 * is: there is nothing here for a screen reader to read twice.
 */
export function DbWriteStatusIcon({
  allowWrites,
  className
}: {
  allowWrites: boolean;
  className?: string;
}) {
  const t = useT();
  const label = t(allowWrites ? "Writes allowed" : "Read-only");
  const hint = t(
    allowWrites
      ? "Writes allowed — statements that change data run here."
      : "Read-only — the gate refuses every statement that is not a read."
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // Focusable so the tooltip is reachable without a pointer; the role
          // makes the label that names it announce as an image rather than as
          // an anonymous span.
          tabIndex={0}
          role="img"
          aria-label={label}
          className={cn("inline-flex size-4 shrink-0 items-center", className)}
        >
          <img src={allowWrites ? writableIcon : readOnlyIcon} alt="" aria-hidden className="size-full" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
