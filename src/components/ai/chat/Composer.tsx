import { useEffect, useRef } from "react";
import { Eraser, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatModShortcut } from "@/lib/keyboardShortcut";

/**
 * The input area: message box, clear-context, and send/stop.
 *
 * Enter sends and Shift+Enter breaks the line — the convention for chat inputs,
 * where sending is the common action and a multi-line message the exception.
 *
 * The draft is controlled by the parent so clicking "Edit" on a past question can
 * load its text here and reuse this box to re-answer it. While `editing` is true
 * the banner explains what Enter does and how to back out, and Esc cancels.
 */
export function Composer({
  disabled,
  streaming,
  value,
  onValueChange,
  editing,
  onSend,
  onCancel,
  onClearContext,
  onCancelEdit
}: {
  disabled: boolean;
  streaming: boolean;
  value: string;
  onValueChange: (value: string) => void;
  editing: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onClearContext: () => void;
  onCancelEdit: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Editing starts from the composer, so it should take focus there.
  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  const trimmed = value.trim();

  const submit = () => {
    if (!trimmed || disabled || streaming) return;
    onValueChange("");
    onSend(trimmed);
  };

  return (
    <div className="shrink-0 space-y-2 border-t p-3">
      {editing && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-accent/60 px-2 py-1 text-xs text-muted-foreground">
          <span>Editing a message — Enter re-answers · Esc cancels</span>
          <button
            type="button"
            aria-label="Cancel editing"
            onClick={onCancelEdit}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape" && editing) {
            event.preventDefault();
            onCancelEdit();
          }
        }}
        placeholder={
          editing
            ? "Edit the question…"
            : disabled
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
            Keep the history visible but stop sending it to the model ({formatModShortcut("K")})
          </TooltipContent>
        </Tooltip>

        {streaming ? (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            <Square className="mr-1.5 size-3.5" />
            Stop
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={submit} disabled={disabled || !trimmed}>
            <Send className="mr-1.5 size-3.5" />
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
