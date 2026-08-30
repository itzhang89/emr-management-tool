import { useState } from "react";
import { Eraser, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The input area: message box, clear-context, and send/stop.
 *
 * Enter sends and Shift+Enter breaks the line — the convention for chat inputs,
 * where sending is the common action and a multi-line message the exception.
 */
export function Composer({
  disabled,
  streaming,
  onSend,
  onCancel,
  onClearContext
}: {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onClearContext: () => void;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || streaming) return;
    setText("");
    onSend(trimmed);
  };

  return (
    <div className="shrink-0 space-y-2 border-t p-3">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={
          disabled
            ? "Select or create a conversation to start"
            : "Ask why a job failed — paste its job id"
        }
        disabled={disabled}
        aria-label="Message"
        className="max-h-40 min-h-[4.5rem] resize-none text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearContext}
              disabled={disabled || streaming}
            >
              <Eraser className="mr-1.5 size-3.5" />
              Clear context
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Keep the history visible but stop sending it to the model
          </TooltipContent>
        </Tooltip>

        {streaming ? (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            <Square className="mr-1.5 size-3.5" />
            Stop
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={submit} disabled={disabled || !text.trim()}>
            <Send className="mr-1.5 size-3.5" />
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
