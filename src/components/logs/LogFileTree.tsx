import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildPodLabelIndex, formatLogPodLabel } from "@/services/logPathDisplay";
import type { JobLogObject, JobLogStream, JobLogTreeSection } from "@/types/domain";

function getItemSelectionId(item: JobLogStream | JobLogObject) {
  return item.source === "s3" ? item.s3Key : item.cloudWatchStreamName;
}

export function LogFileTree({
  tree,
  selectedId,
  onSelect,
  collapsed,
  onToggleCollapsed,
  collapseShortcut
}: {
  tree: JobLogTreeSection[];
  selectedId?: string;
  onSelect: (item: JobLogStream | JobLogObject) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  collapseShortcut?: string;
}) {
  const podLabelIndex = buildPodLabelIndex(tree);

  if (collapsed) {
    return (
      <nav
        aria-label="Log files"
        className="flex min-h-0 w-[4.75rem] shrink-0 flex-col border-r bg-card py-2"
      >
        <div className="flex justify-center px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mb-2 size-7"
                aria-label="Expand log files panel"
                onClick={onToggleCollapsed}
              >
                <PanelLeftOpen className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Show log files{collapseShortcut ? ` · ${collapseShortcut}` : ""}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto px-1">
          {tree.map((section) =>
            section.groups.map((group) => {
              const groupKey = `${section.type}:${group.label}`;
              const podIndex = podLabelIndex.get(groupKey) ?? 0;
              const podShort = formatLogPodLabel(group.label, section.type, podIndex);
              return (
                <div key={groupKey} className="flex flex-col items-center gap-0.5">
                  <div
                    className="w-full truncate px-0.5 text-center font-mono text-[9px] font-semibold leading-tight text-muted-foreground"
                    title={group.label}
                  >
                    {podShort}
                  </div>
                  {group.items.map((item) => {
                    const selectionId = getItemSelectionId(item);
                    const selected = selectionId === selectedId;
                    return (
                      <Tooltip key={item.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-current={selected ? "true" : undefined}
                            aria-label={`${podShort} ${item.stream}`}
                            className={cn(
                              "flex h-7 w-full items-center justify-center rounded-md hover:bg-accent",
                              selected ? "bg-primary text-primary-foreground hover:bg-primary" : undefined
                            )}
                            onClick={() => onSelect(item)}
                          >
                            <StreamBadge stream={item.stream} selected={selected} compact />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {podShort} · {item.stream}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </nav>
    );
  }

  return (
    <nav aria-label="Log files" className="flex min-h-0 w-[280px] shrink-0 flex-col border-r bg-card">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <div className="min-w-0 flex-1 truncate px-1 text-sm font-medium">Log files</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Collapse log files panel"
              onClick={onToggleCollapsed}
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Hide log files{collapseShortcut ? ` · ${collapseShortcut}` : ""}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {tree.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">No log streams found for this job.</p>
        ) : null}
        {tree.map((section) => (
          <div key={section.type} className="mb-2">
            <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
            {section.groups.map((group) => {
              const groupKey = `${section.type}:${group.label}`;
              const podIndex = podLabelIndex.get(groupKey) ?? 0;
              const podShort = formatLogPodLabel(group.label, section.type, podIndex);
              return (
                <div key={group.label} className="mb-1">
                  <div className="truncate px-2 py-0.5 text-[11px] text-muted-foreground" title={group.label}>
                    {podShort}
                    {group.items.length > 1 ? ` (${group.items.length})` : ""}
                  </div>
                  {group.items.map((item) => {
                    const selectionId = getItemSelectionId(item);
                    const selected = selectionId === selectedId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "mb-0.5 flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                          selected ? "bg-primary text-primary-foreground hover:bg-primary" : undefined
                        )}
                        onClick={() => onSelect(item)}
                      >
                        <StreamBadge stream={item.stream} selected={selected} />
                        <span
                          className={cn(
                            "shrink-0 text-[10px]",
                            selected ? "text-primary-foreground/80" : "text-muted-foreground"
                          )}
                        >
                          {item.source === "s3" ? formatBytes((item as JobLogObject).size) : "live"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

function StreamBadge({
  stream,
  selected,
  compact
}: {
  stream: string;
  selected: boolean;
  compact?: boolean;
}) {
  const isStderr = stream === "stderr";
  return (
    <Badge
      variant={isStderr ? "destructive" : "secondary"}
      className={cn(
        "font-mono text-[10px]",
        compact && "px-1 py-0",
        selected && !isStderr && "bg-primary-foreground/20 text-primary-foreground"
      )}
    >
      {compact ? (isStderr ? "err" : "out") : stream}
    </Badge>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
