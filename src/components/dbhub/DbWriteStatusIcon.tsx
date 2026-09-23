import { useId, useState } from "react";
import readOnlyIcon from "@/assets/status/read-only.svg";
import writableIcon from "@/assets/status/writable.svg";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Whether this connection may write, as the status set's own mark — a blue eye
 * for read-only, a green pencil for writable — and, where the caller allows it,
 * the control that changes it.
 *
 * This replaces the text badge it used to be, which is why the wording moved
 * into the tooltip rather than simply disappearing: the header has room for the
 * state, not for the sentence explaining it, and a hover is where a reader who
 * wants the sentence is already looking.
 *
 * Handing it `onSetWrites` turns the mark into a button opening a popover with
 * the switch. The state's *meaning* is on hover and the change is behind a
 * click, so the one surface both tells you what the connection is and lets you
 * make it something else — but flipping it is never a single stray click,
 * because writes are the direction that can destroy data and the popover is
 * where the consequence is spelled out.
 *
 * Passing no `onSetWrites` leaves it as pure display: a focusable span that
 * shows the state to a keyboard reader too. A mark with nothing behind the
 * click would be a lie about what pressing it does.
 */
export function DbWriteStatusIcon({
  allowWrites,
  onSetWrites,
  pending = false,
  className
}: {
  allowWrites: boolean;
  /** Present → the mark is a control; absent → it only reports. */
  onSetWrites?: (allowWrites: boolean) => void;
  /** A change is in flight: the switch is held until it lands. */
  pending?: boolean;
  className?: string;
}) {
  const t = useT();
  const switchId = useId();
  const [open, setOpen] = useState(false);
  /**
   * The tooltip's own state, tracked rather than left uncontrolled.
   *
   * It has to be *forced* shut while the popover is open — both hang off the
   * same trigger, and the popover is saying the same sentence a few pixels
   * below the pointer. Closing it that way means passing `open`, and a Radix
   * root that receives `open` on one render and nothing on the next is a root
   * switching between controlled and uncontrolled, which React warns about. So
   * it is controlled from the start and the two states are combined on the way
   * out.
   */
  const [hovered, setHovered] = useState(false);

  const label = t(allowWrites ? "Writes allowed" : "Read-only");
  const hint = t(
    allowWrites
      ? "Writes allowed — statements that change data run here."
      : "Read-only — the gate refuses every statement that is not a read."
  );

  const mark = (
    <img src={allowWrites ? writableIcon : readOnlyIcon} alt="" aria-hidden className="size-full" />
  );

  if (!onSetWrites) {
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
            {mark}
          </span>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* The tooltip is suppressed while the popover is open: both would hang
          off the same trigger, and the popover already says the same sentence
          a few pixels below the pointer. */}
      <Tooltip open={hovered && !open} onOpenChange={setHovered}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className={cn(
                "inline-flex size-4 shrink-0 cursor-pointer items-center rounded-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                className
              )}
            >
              {mark}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <Label htmlFor={switchId} className="text-sm font-normal">
            {t("Allow writes")}
          </Label>
          <Switch
            id={switchId}
            checked={allowWrites}
            disabled={pending}
            onCheckedChange={onSetWrites}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("Your own queries may modify this database — the AI still cannot")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
