import { RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { JOB_HISTORY_REFRESH_INTERVAL_SECONDS } from "@/services/jobHistoryConstants";

/**
 * Auto-refresh, as one compact control: the switch, and — while it is on — the
 * countdown to the next fetch beside it. The words "Auto refresh" are gone from
 * the toolbar because the tooltip says it better and because every saved
 * character goes to the search box next door; the thing worth screen space is
 * the number that changes.
 *
 * The switch keeps its `aria-label`, so the accessible name is unchanged.
 */
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
  const t = useT();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2">
          <Switch
            id={id}
            checked={autoRefresh}
            onCheckedChange={onAutoRefreshChange}
            aria-label={t("Auto refresh job history")}
          />
          {/* A label, not a span: clicking the icon or the number toggles the
              switch too, which is a bigger target than the switch alone. */}
          <label
            htmlFor={id}
            className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"
          >
            <RefreshCw className={cn("size-3.5", autoRefresh && isFetching ? "animate-spin" : undefined)} />
            {autoRefresh ? <span className="tabular-nums">{refreshCountdown}s</span> : null}
          </label>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {t("Reloads the job list every {seconds} seconds while it is on", {
          seconds: JOB_HISTORY_REFRESH_INTERVAL_SECONDS
        })}
      </TooltipContent>
    </Tooltip>
  );
}
