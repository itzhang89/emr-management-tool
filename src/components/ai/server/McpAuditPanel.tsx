import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Copy, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useLlmProviders } from "@/hooks/useLlmConfig";
import { tauriClient } from "@/services/tauriClient";
import type { LlmProvider, McpAuditEntry } from "@/types/domain";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * One-line JSON for table cells. The cell itself truncates with CSS, so this
 * only caps the string to keep very large responses out of the DOM.
 */
function inlineJson(value: unknown): string {
  const text = JSON.stringify(value ?? {}) ?? "{}";
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

/**
 * Copies a JSON value to the clipboard. Used by the expanded audit row and by
 * the Chat panel's tool-call steps, so both views of "what a tool did" behave
 * the same.
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

/**
 * One label for "who called this tool". In-process Chat rows record the
 * provider + model that drove the call; external HTTP-agent rows have neither.
 * The provider is looked up by id so the row reads e.g. "Anthropic ·
 * claude-opus-4-8"; if a provider was deleted the id falls back to the model id
 * alone rather than a dangling reference.
 */
function modelLabel(entry: McpAuditEntry, providersById: Map<string, LlmProvider>): string {
  if (!entry.modelId) return "—";
  const provider = entry.providerId ? providersById.get(entry.providerId) : undefined;
  const name = provider?.name ?? "";
  return name ? `${name} · ${entry.modelId}` : entry.modelId;
}

function AuditLogRow({
  entry,
  providersById
}: {
  entry: McpAuditEntry;
  providersById: Map<string, LlmProvider>;
}) {
  const [expanded, setExpanded] = useState(false);
  const isError = entry.status === "error" || Boolean(entry.error);
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <TableCell className="w-8 pr-0">
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs">
          {format(new Date(entry.timestamp), "yyyy-MM-dd HH:mm:ss")}
        </TableCell>
        <TableCell>
          {isError ? (
            <Badge variant="destructive" className="text-xs">
              Error
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            >
              Success
            </Badge>
          )}
        </TableCell>
        <TableCell className="truncate font-mono text-xs">{entry.tool}</TableCell>
        <TableCell className="truncate font-mono text-xs text-muted-foreground">
          {modelLabel(entry, providersById)}
        </TableCell>
        <TableCell className="truncate font-mono text-xs text-muted-foreground">
          {entry.client || "—"}
        </TableCell>
        <TableCell className="truncate font-mono text-xs text-muted-foreground">
          {inlineJson(entry.args)}
        </TableCell>
        <TableCell className="truncate font-mono text-xs text-muted-foreground">
          {isError ? entry.error : inlineJson(entry.result)}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDuration(entry.durationMs)}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-muted/30">
          <TableCell colSpan={9} className="bg-muted/30 py-3">
            <div className="space-y-3">
              {/* Responses dwarf the arguments, so split the width 1:4 rather
                  than evenly. */}
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,4fr)]">
                <div className="min-w-0 space-y-1">
                  <div className="flex h-7 items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Request arguments</p>
                    <CopyJsonButton value={entry.args} label="Request arguments" />
                  </div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                    {formatJson(entry.args)}
                  </pre>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex h-7 items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Response content</p>
                    <CopyJsonButton value={entry.result} label="Response content" />
                  </div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                    {formatJson(entry.result)}
                  </pre>
                </div>
              </div>
              {entry.error && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">Error</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                    {entry.error}
                  </pre>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// The "Audit" tab trigger is the only label for this view — the panel itself
// renders just the structured table, with no repeated heading or description.
export function McpAuditPanel() {
  const { data: entries, isLoading } = useQuery({
    queryKey: ["mcp-audit-entries"],
    queryFn: () => tauriClient.listMcpAuditEntries(500),
    // Always show the latest rows the MCP server has written.
    refetchInterval: 3000,
    refetchOnWindowFocus: true
  });
  const { data: providers } = useLlmProviders();
  const providersById = useMemo(
    () => new Map((providers ?? []).map((provider) => [provider.id, provider])),
    [providers]
  );

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading entries...
      </p>
    );
  }

  if ((entries ?? []).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tool invocations recorded yet. Entries appear here after an AI assistant calls a tool through the MCP
        server.
      </p>
    );
  }

  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border">
      {/* Fixed layout so the sized metadata columns stay put and Arguments /
          Response absorb the remaining desktop width. */}
      <Table className="w-full table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead className="w-40">Time</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-44">Tool</TableHead>
            <TableHead className="w-48">Provider / Model</TableHead>
            <TableHead className="w-40">Client</TableHead>
            <TableHead className="w-[22%]">Arguments</TableHead>
            <TableHead>Response</TableHead>
            <TableHead className="w-24">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(entries ?? []).map((entry) => (
            <AuditLogRow key={entry.id} entry={entry} providersById={providersById} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
