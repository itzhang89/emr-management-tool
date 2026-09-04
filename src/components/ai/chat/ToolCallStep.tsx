import { useState } from "react";
import { ChevronRight, CircleAlert, LoaderCircle, Wrench } from "lucide-react";
import { CopyJsonButton } from "@/components/ui/CopyJsonButton";
import { formatDuration, formatJson } from "@/lib/format";
import { formatElapsed, useLiveClock } from "@/hooks/useLiveClock";
import { cn } from "@/lib/utils";
import type { ChatToolCall } from "@/types/domain";
import type { LiveToolCall } from "@/services/chatStream";

/** A tool step, from either a live stream event or a persisted message. */
export type ToolStep = {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  durationMs?: number | null;
  /** Stamped when the "start" event arrives, so a running step can show a clock. */
  startedAt?: number | null;
  running: boolean;
};

export function toolStepFromEvent(event: LiveToolCall): ToolStep {
  return {
    callId: event.callId,
    tool: event.tool,
    args: event.args,
    result: event.result,
    error: event.error,
    durationMs: event.durationMs,
    startedAt: event.phase === "start" ? event.startedAt ?? Date.now() : null,
    running: event.phase === "start"
  };
}

export function toolStepFromStored(call: ChatToolCall): ToolStep {
  return {
    callId: call.callId,
    tool: call.tool,
    args: call.args,
    result: call.result,
    error: call.error,
    durationMs: call.durationMs,
    running: false
  };
}

/**
 * One collapsible tool step. Collapsed it is a single, quiet line — an automatic
 * step the model took, no louder than needed; expanded it shows the arguments
 * and result.
 *
 * Tool activity is deliberately visible rather than hidden: the model reaches
 * into the user's AWS accounts, and they should be able to see which reads it
 * performed. This is the same transparency the Audit tab gives external agents,
 * and it reuses that tab's JSON rendering so both read alike.
 */
export function ToolCallStep({ step }: { step: ToolStep }) {
  const [expanded, setExpanded] = useState(false);
  const failed = Boolean(step.error);
  const clock = useLiveClock(step.running && step.startedAt != null);
  const runningMs =
    step.running && step.startedAt != null && clock != null ? clock - step.startedAt : null;

  return (
    <div className="overflow-hidden rounded-md border bg-muted/25">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-sm hover:bg-muted/60"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/70 transition-transform",
            expanded && "rotate-90"
          )}
        />
        {step.running ? (
          <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground/70" />
        ) : failed ? (
          <CircleAlert className="size-3 shrink-0 text-destructive/80" />
        ) : (
          <Wrench className="size-3 shrink-0 text-muted-foreground/70" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{step.tool}</span>
        {runningMs != null ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
            {formatElapsed(runningMs)}
          </span>
        ) : step.durationMs != null ? (
          <span className="shrink-0 text-xs text-muted-foreground/70">{formatDuration(step.durationMs)}</span>
        ) : null}
        <span
          className={cn(
            "shrink-0 text-[10px] uppercase tracking-wide",
            step.running
              ? "text-muted-foreground/70"
              : failed
                ? "text-destructive/80"
                : "text-muted-foreground/50"
          )}
        >
          {step.running ? "Running" : failed ? "Failed" : "Done"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t px-1.5 py-1.5">
          <div className="space-y-1">
            <div className="flex h-6 items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Arguments
              </p>
              <CopyJsonButton value={step.args} label="Arguments" />
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs leading-relaxed">
              {formatJson(step.args)}
            </pre>
          </div>

          {step.error ? (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-destructive">Error</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-destructive/10 p-2 font-mono text-xs leading-relaxed text-destructive">
                {step.error}
              </pre>
            </div>
          ) : step.result != null ? (
            <div className="space-y-1">
              <div className="flex h-6 items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Result
                </p>
                <CopyJsonButton value={step.result} label="Result" />
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs leading-relaxed">
                {formatJson(step.result)}
              </pre>
            </div>
          ) : (
            !step.running && <p className="text-xs text-muted-foreground">No output.</p>
          )}
        </div>
      )}
    </div>
  );
}
