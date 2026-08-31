import { useState } from "react";
import { AtSign, Bot, CircleAlert, Copy, LoaderCircle, Pencil, RefreshCw, Trash2, User } from "lucide-react";
import { Markdown } from "@/components/ai/chat/Markdown";
import { ToolCallStep, type ToolStep } from "@/components/ai/chat/ToolCallStep";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Tailwind classes per assistant accent, so avatars are distinguishable. */
const ACCENTS: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
};

export function accentClasses(accent?: string | null): string {
  return ACCENTS[accent ?? ""] ?? "bg-muted text-muted-foreground";
}

export const ACCENT_NAMES = Object.keys(ACCENTS);

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** A model option offered in the assistant's switch-model submenu. */
export type ModelActionOption = {
  id: string;
  modelId: string;
  providerName: string;
  endpointName: string;
};

export function UserMessage({
  text,
  onCopy,
  onEdit,
  onDelete
}: {
  text: string;
  onCopy: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="group flex gap-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">You</p>
        {/* Preserve the user's own line breaks. */}
        <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
        <ActionRow visible={hovered}>
          <ActionIcon label="Copy" onClick={onCopy}>
            <Copy className="size-3.5" />
          </ActionIcon>
          <ActionIcon label="Edit" onClick={() => onEdit(text)}>
            <Pencil className="size-3.5" />
          </ActionIcon>
          <ActionIcon label="Delete" destructive onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </ActionIcon>
        </ActionRow>
      </div>
    </div>
  );
}

/**
 * One assistant turn: who answered, the tools it used, and its markdown-rendered
 * answer.
 *
 * Tool steps render above the answer because that is the order they happened —
 * the model reads before it concludes, and showing the reads first makes the
 * conclusion checkable. The hover-revealed action row sits below everything.
 */
export function AssistantMessage({
  assistantName,
  accent,
  modelId,
  text,
  toolSteps,
  durationMs,
  error,
  streaming,
  modelOptions,
  onCopy,
  onRegenerate,
  onRegenerateWithModel,
  onDelete
}: {
  assistantName: string;
  accent?: string | null;
  modelId?: string | null;
  text?: string | null;
  toolSteps: ToolStep[];
  durationMs?: number | null;
  error?: string | null;
  streaming?: boolean;
  modelOptions: ModelActionOption[];
  onCopy: () => void;
  onRegenerate: () => void;
  onRegenerateWithModel: (modelId: string) => void;
  onDelete: () => void;
}) {
  const hasBody = Boolean(text) || toolSteps.length > 0 || Boolean(error);
  const [hovered, setHovered] = useState(false);
  // The model list is portaled outside the message, so hovering it no longer
  // counts as hovering the message; keep the row up while it is open.
  const [modelListOpen, setModelListOpen] = useState(false);

  return (
    <div
      className="group flex gap-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          accentClasses(accent)
        )}
      >
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-medium">{assistantName}</span>
          {modelId && <span className="font-mono text-muted-foreground">{modelId}</span>}
          {durationMs != null && (
            <span className="text-muted-foreground">{formatDuration(durationMs)}</span>
          )}
          {streaming && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              {toolSteps.some((step) => step.running) ? "Running tools" : "Thinking"}
            </span>
          )}
        </div>

        {toolSteps.length > 0 && (
          <div className="space-y-1">
            {toolSteps.map((step) => (
              <ToolCallStep key={step.callId} step={step} />
            ))}
          </div>
        )}

        {text && <Markdown text={text} />}

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {!hasBody && !streaming && <p className="text-xs text-muted-foreground">No response.</p>}

        <ActionRow visible={hovered || modelListOpen}>
          <ActionIcon label="Copy" onClick={onCopy}>
            <Copy className="size-3.5" />
          </ActionIcon>
          {/* Regenerating a still-streaming reply would fight the user, so that
              action waits until the turn has settled. */}
          {!streaming && (
            <>
              <ActionIcon label="Regenerate" onClick={onRegenerate}>
                <RefreshCw className="size-3.5" />
              </ActionIcon>
              <SwitchModelIcon
                modelOptions={modelOptions}
                onPick={onRegenerateWithModel}
                onOpenChange={setModelListOpen}
              />
            </>
          )}
          <ActionIcon label="Delete" destructive onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </ActionIcon>
        </ActionRow>
      </div>
    </div>
  );
}

/**
 * The hover-revealed action row under a message.
 *
 * The icons are *unmounted* when hidden rather than made transparent: an
 * `opacity-0` row still answers the mouse, so its buttons stayed clickable and
 * its tooltip could linger in its portal after the pointer had left — which read
 * as icons that never went away. The row keeps its height either way, so
 * revealing them does not shift the transcript.
 */
function ActionRow({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center gap-0.5 pt-1">
      {visible ? children : null}
    </div>
  );
}

/** A single small ghost icon button in the action row, with a tooltip. */
function ActionIcon({
  label,
  destructive,
  onClick,
  children
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground",
            destructive ? "hover:text-destructive" : ""
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The "@" switch-model action: regenerate the reply on a different model. Clicking
 * it opens the model list; picking one regenerates with that model. The glyph
 * distinguishes it from the plain "Regenerate" arrow next to it.
 *
 * `onOpenChange` is reported upwards because the list is portaled outside the
 * message: without it, moving the mouse onto the list would count as leaving the
 * message and unmount the row — taking the list with it before a model could be
 * picked.
 */
function SwitchModelIcon({
  modelOptions,
  onPick,
  onOpenChange
}: {
  modelOptions: ModelActionOption[];
  onPick: (modelId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Regenerate with a different model"
          className={cn(
            "flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground",
            modelOptions.length === 0 && "pointer-events-none opacity-50"
          )}
        >
          <AtSign className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-48 p-1">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Switch model</p>
        {modelOptions.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            No models configured. Open LLM Setting to add one.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {modelOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  change(false);
                  onPick(option.id);
                }}
                className="flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-sm hover:bg-accent"
              >
                <span className="truncate font-mono text-xs">{option.modelId}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The "context cleared" divider. The messages above it stay readable, but they
 * are no longer sent to the model — which is what makes this a visible marker
 * rather than a deletion.
 */
export function ContextResetDivider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Context cleared
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
