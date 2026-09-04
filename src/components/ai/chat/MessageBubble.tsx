import { useState } from "react";
import { format as formatDate } from "date-fns";
import {
  AtSign,
  Bot,
  CircleAlert,
  Copy,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Settings2,
  Trash2,
  User
} from "lucide-react";
import { accentClasses } from "@/components/ai/chat/accents";
import { ErrorDetails } from "@/components/ai/chat/ErrorDetails";
import { Markdown } from "@/components/ai/chat/Markdown";
import { ToolCallStep, type ToolStep } from "@/components/ai/chat/ToolCallStep";
import { formatDuration } from "@/lib/format";
import { formatElapsed, useLiveClock } from "@/hooks/useLiveClock";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChatErrorDetails, ChatMessageVersionSummary } from "@/types/domain";

/**
 * One model the "@" menu offers: a currently-configured, chat-capable model the
 * user can answer this message with. `id` is the LlmModel row id regeneration
 * resolves; `modelId` is the API-facing name shown in the menu.
 */
export type ModelActionOption = {
  id: string;
  modelId: string;
  providerName: string;
};

export function UserMessage({
  text,
  dimmed = false,
  createdAt,
  onCopy,
  onEdit,
  onDelete
}: {
  text: string;
  /** Grey the message out while it is being edited through the composer. */
  dimmed?: boolean;
  /** When the message was sent; shown on hover as MM/dd HH:mm. */
  createdAt?: string | null;
  onCopy: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={cn("group flex gap-3", dimmed && "opacity-50")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <p className="font-medium text-muted-foreground">You</p>
          {/* The send time appears next to the name while the mouse is over this
              message, and disappears when it leaves. */}
          {hovered && createdAt && (
            <span className="text-muted-foreground/60">
              {formatDate(new Date(createdAt), "MM/dd HH:mm")}
            </span>
          )}
        </div>
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
  errorDetails,
  streaming,
  startedAt,
  versions,
  modelOptions,
  createdAt,
  onConfigureProvider,
  onCopy,
  onRegenerate,
  onRegenerateWithModel,
  onSwitchVersion,
  onDelete
}: {
  assistantName: string;
  accent?: string | null;
  modelId?: string | null;
  text?: string | null;
  toolSteps: ToolStep[];
  durationMs?: number | null;
  error?: string | null;
  /** Structured diagnostics behind the error line, when the backend captured them. */
  errorDetails?: ChatErrorDetails | null;
  streaming?: boolean;
  /** When the streaming turn began (ms epoch); drives the live elapsed clock. */
  startedAt?: number | null;
  /**
   * Every answer recorded for this message. When there are several, the numbered
   * capsule bar lets the user switch which one is shown; clicking a capsule swaps
   * the displayed version immediately (the row's content mirrors it afterwards).
   */
  versions: ChatMessageVersionSummary[];
  /** Models the "@" action offers — the conversation's currently-configured chat models. */
  modelOptions: ModelActionOption[];
  /** When the reply was sent; the header tooltip shows this as MM/DD HH:mm. */
  createdAt?: string | null;
  /** Open the Providers tab for this reply's provider, when one can be resolved. */
  onConfigureProvider?: () => void;
  onCopy: () => void;
  /** Re-answer on the currently displayed version's model, appending a new version. */
  onRegenerate: () => void;
  /** Re-answer on a picked model, appending a new version (the "@" action). */
  onRegenerateWithModel: (modelId: string) => void;
  /** Show a different recorded version of this answer. */
  onSwitchVersion: (versionId: string) => void;
  onDelete: () => void;
}) {
  const hasBody = Boolean(text) || toolSteps.length > 0 || Boolean(error);
  const [hovered, setHovered] = useState(false);
  // The "@" action: which configured model to re-answer on.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const clock = useLiveClock(Boolean(streaming && startedAt != null));
  const elapsedMs =
    streaming && startedAt != null && clock != null ? clock - startedAt : null;
  const activity = toolSteps.some((step) => step.running)
    ? "Running tools…"
    : text
      ? "Generating…"
      : "Waiting for model…";

  // Regenerate always re-answers on the version currently shown. Picking a model
  // in the "@" menu regenerates immediately on that model — either way a fresh
  // version is appended and the old ones stay switchable. Once a message has been
  // re-answered at all (two or more versions), the capsules ride along with the
  // action row so switching versions needs no trip through the "@" model menu.
  const multipleVersions = versions.length > 1;

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
          {durationMs != null && !streaming && (
            <>
              <span className="text-muted-foreground">{formatDuration(durationMs)}</span>
              {/* The send time appears next to the duration while the mouse is
                  over this message, and disappears when it leaves. */}
              {hovered && createdAt && (
                <span className="text-muted-foreground/60">
                  {formatDate(new Date(createdAt), "MM/dd HH:mm")}
                </span>
              )}
            </>
          )}
          {streaming && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              {activity}
              {elapsedMs != null && (
                <span className="tabular-nums text-muted-foreground/80">{formatElapsed(elapsedMs)}</span>
              )}
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
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
            <ErrorDetails details={errorDetails} />
            {onConfigureProvider && (
              <button
                type="button"
                onClick={onConfigureProvider}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-destructive/30 px-2 py-1 text-[11px] font-medium hover:bg-destructive/10"
              >
                <Settings2 className="size-3.5" />
                Open provider settings
              </button>
            )}
          </div>
        )}

        {!hasBody && !streaming && <p className="text-xs text-muted-foreground">No response.</p>}

        {/* The action row is kept mounted while a version capsule is hovered, so
            moving between the icons and the capsules does not hide the actions. */}
        <ActionRow visible={hovered || modelMenuOpen}>
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
              <ModelMenu
                options={modelOptions}
                open={modelMenuOpen}
                onOpenChange={setModelMenuOpen}
                onPick={onRegenerateWithModel}
              />
            </>
          )}
          <ActionIcon label="Delete" destructive onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </ActionIcon>
          {/* A regenerated message (two or more versions) shows the version
              capsules whenever the action row is up — no need to open the "@"
              model menu first. They sit right after the tool buttons, so they
              read as "which of this message's answers is shown". Clicking a
              capsule switches it immediately and persists. */}
          {!streaming && multipleVersions && (
            <VersionCapsuleBar versions={versions} onSwitch={onSwitchVersion} />
          )}
        </ActionRow>
      </div>
    </div>
  );
}

/**
 * The "@" action: opens the list of models this conversation can be answered
 * with. Picking one immediately regenerates the message on that model — a fresh
 * version that joins (not replaces) the existing ones.
 */
function ModelMenu({
  options,
  open,
  onOpenChange,
  onPick
}: {
  options: ModelActionOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (modelId: string) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Answer with another model"
          className={cn(
            "flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground",
            open && "bg-muted text-foreground",
            options.length === 0 && "pointer-events-none opacity-50"
          )}
        >
          <AtSign className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-1">
        <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Answer with…
        </p>
        {options.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            No other model is configured.
          </p>
        ) : (
          options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onOpenChange(false);
                onPick(option.modelId);
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <span className="font-mono truncate">{option.modelId}</span>
              <span className="shrink-0 text-muted-foreground">{option.providerName}</span>
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The version switch for a message that has been regenerated: each recorded
 * answer is one numbered button (1, 2, … in the order it was produced), and the
 * whole set is drawn inside a single bordered pill so the attempts read as one
 * switchable group. Clicking a capsule switches the message to that version
 * immediately and persists the choice.
 */
function VersionCapsuleBar({
  versions,
  onSwitch
}: {
  versions: ChatMessageVersionSummary[];
  onSwitch: (versionId: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Answer versions"
      className="flex items-center gap-0.5 rounded-full border border-border bg-background/60 p-0.5"
    >
      {versions.map((version, index) => (
        <VersionCapsule
          key={version.id}
          number={index + 1}
          active={version.isActive}
          onSwitch={() => onSwitch(version.id)}
        />
      ))}
    </div>
  );
}

/**
 * One version in the switch group: a pure number (1, 2, …). The one currently
 * shown is highlighted; clicking another switches the displayed version. The
 * producing model is shown in the message header, not repeated per capsule.
 */
function VersionCapsule({
  number,
  active,
  onSwitch
}: {
  number: number;
  active: boolean;
  onSwitch: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSwitch}
      aria-label={active ? `Showing version ${number}` : `Show version ${number}`}
      aria-pressed={active}
      className={cn(
        "flex h-5 min-w-6 items-center justify-center rounded-full px-1.5 text-[10px] transition-colors",
        active
          ? "bg-foreground/10 font-medium text-foreground"
          : "text-muted-foreground/70 hover:text-muted-foreground"
      )}
    >
      <span className="tabular-nums">{number}</span>
    </button>
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
