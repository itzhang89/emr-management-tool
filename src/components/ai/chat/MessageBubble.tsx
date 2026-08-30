import { Bot, CircleAlert, LoaderCircle, User } from "lucide-react";
import { ToolCallStep, type ToolStep } from "@/components/ai/chat/ToolCallStep";
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

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">You</p>
        {/* Preserve the user's own line breaks. */}
        <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
      </div>
    </div>
  );
}

/**
 * One assistant turn: who answered, the tools it used, and its text.
 *
 * Tool steps render above the answer because that is the order they happened —
 * the model reads before it concludes, and showing the reads first makes the
 * conclusion checkable.
 */
export function AssistantMessage({
  assistantName,
  accent,
  modelId,
  text,
  toolSteps,
  durationMs,
  error,
  streaming
}: {
  assistantName: string;
  accent?: string | null;
  modelId?: string | null;
  text?: string | null;
  toolSteps: ToolStep[];
  durationMs?: number | null;
  error?: string | null;
  streaming?: boolean;
}) {
  const hasBody = Boolean(text) || toolSteps.length > 0 || Boolean(error);

  return (
    <div className="flex gap-3">
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

        {text && <p className="whitespace-pre-wrap break-words text-sm">{text}</p>}

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {!hasBody && !streaming && <p className="text-xs text-muted-foreground">No response.</p>}
      </div>
    </div>
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
