import { RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function JobAutoRefreshToggle({
  id,
  autoRefresh,
  onAutoRefreshChange,
  isFetching,
  refreshCountdown
}: {
  id: string;
  autoRefresh: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  isFetching?: boolean;
  refreshCountdown: number;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 rounded-md border px-2">
      <Switch
        id={id}
        checked={autoRefresh}
        onCheckedChange={onAutoRefreshChange}
        aria-label="Auto refresh job history"
      />
      <label htmlFor={id} className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
        <RefreshCw className={cn("size-3.5", autoRefresh && isFetching ? "animate-spin" : undefined)} />
        Auto refresh
        {autoRefresh ? <span className="tabular-nums">{refreshCountdown}s</span> : null}
      </label>
    </div>
  );
}
