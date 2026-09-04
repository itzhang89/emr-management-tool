import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatJson } from "@/lib/format";

/**
 * Copies a JSON value to the clipboard. Used by the MCP audit table's expanded
 * row and by the Chat panel's tool-call steps, so both views of "what a tool
 * did" behave the same.
 */
export function CopyJsonButton({ value, label }: { value: unknown; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={`Copy ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            navigator.clipboard.writeText(formatJson(value)).then(
              () => toast.success(`${label} copied`),
              () => toast.error("Failed to copy to clipboard")
            );
          }}
        >
          <Copy className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy {label}</TooltipContent>
    </Tooltip>
  );
}
