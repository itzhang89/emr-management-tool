import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { buildPodLabelIndex, formatLogPodLabel } from "@/services/logPathDisplay";
import type { JobLogObject, JobLogStream, JobLogTreeSection } from "@/types/domain";

function getItemSelectionId(item: JobLogStream | JobLogObject) {
  return item.source === "s3" ? item.s3Key : item.cloudWatchStreamName;
}

export function LogFileTree({
  tree,
  selectedId,
  onSelect
}: {
  tree: JobLogTreeSection[];
  selectedId?: string;
  onSelect: (item: JobLogStream | JobLogObject) => void;
}) {
  const podLabelIndex = buildPodLabelIndex(tree);

  return (
    <nav aria-label="Log files" className="flex min-h-0 w-[280px] shrink-0 flex-col border-r bg-card">
      <div className="shrink-0 border-b px-3 py-2">
        <div className="text-sm font-medium">Log files</div>
        <div className="text-xs text-muted-foreground">Controller, driver, executor stdout/stderr</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tree.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No log streams found for this job.</p>
        ) : null}
        {tree.map((section) => (
          <div key={section.type} className="mb-3">
            <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
            {section.groups.map((group) => {
              const groupKey = `${section.type}:${group.label}`;
              const podIndex = podLabelIndex.get(groupKey) ?? 0;
              const podShort = formatLogPodLabel(group.label, section.type, podIndex);
              return (
                <div key={group.label} className="mb-2">
                  <div className="truncate px-2 py-1 text-xs text-muted-foreground" title={group.label}>
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
                        "mb-1 flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                        selected ? "bg-primary text-primary-foreground hover:bg-primary" : undefined
                      )}
                      onClick={() => onSelect(item)}
                    >
                      <StreamBadge stream={item.stream} selected={selected} />
                      <span
                        className={cn(
                          "shrink-0 text-xs",
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

function StreamBadge({ stream, selected }: { stream: string; selected: boolean }) {
  const isStderr = stream === "stderr";
  return (
    <Badge
      variant={isStderr ? "destructive" : "secondary"}
      className={cn("font-mono text-[10px]", selected && !isStderr && "bg-primary-foreground/20 text-primary-foreground")}
    >
      {stream}
    </Badge>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
