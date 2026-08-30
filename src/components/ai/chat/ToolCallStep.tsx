import { useState } from "react";
import { ChevronRight, CircleAlert, LoaderCircle, Wrench } from "lucide-react";
import { CopyJsonButton, formatJson } from "@/components/ai/server/McpAuditPanel";
import { cn } from "@/lib/utils";
import type { ChatToolCall, ChatToolEvent } from "@/types/domain";

/** A tool step, from either a live stream event or a persisted message. */
export type ToolStep = {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  durationMs?: number | null;
  running: boolean;
};

export function toolStepFromEvent(event: ChatToolEvent): ToolStep {
  return {
    callId: event.callId,
    tool: event.tool,
    args: event.args,
    result: event.result,
    error: event.error,
    durationMs: event.durationMs,
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * One collapsible tool step. Collapsed it is a single line — name, duration,
 * status; expanded it shows the arguments and result.
 *
 * Tool activity is deliberately visible rather than hidden: the model reaches
 * into the user's AWS accounts, and they should be able to see which reads it
 * performed. This is the same transparency the Audit tab gives external agents,
 * and it reuses that tab's JSON rendering so both read alike.
 */
export function ToolCallStep({ step }: { step: ToolStep }) {
  const [expanded, setExpanded] = useState(false);
  const failed = Boolean(step.error);

  return (
    <div className="overflow-hidden rounded-md border bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/60"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
        {step.running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : failed ? (
          <CircleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono">{step.tool}</span>
        {step.durationMs != null && (
          <span className="shrink-0 text-muted-foreground">{formatDuration(step.durationMs)}</span>
        )}
        <span
          className={cn(
            "shrink-0 text-[10px] uppercase tracking-wide",
            step.running
              ? "text-muted-foreground"
              : failed
                ? "text-destructive"
                : "text-green-600 dark:text-green-500"
          )}
        >
          {step.running ? "Running" : failed ? "Failed" : "Done"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t px-2 py-2">
          <div className="space-y-1">
            <div className="flex h-6 items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Arguments
              </p>
              <CopyJsonButton value={step.args} label="Arguments" />
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
              {formatJson(step.args)}
            </pre>
          </div>

          {step.error ? (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-destructive">Error</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-destructive/10 p-2 text-xs text-destructive">
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
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
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
