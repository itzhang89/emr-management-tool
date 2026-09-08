import { Database, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSetDbConnectionFlags } from "@/hooks/useDbHub";
import { formatAppError } from "@/services/appErrorMessage";
import { toast } from "sonner";
import type { DbConnection, NetworkProfile } from "@/types/domain";

/**
 * One connection on the Overview board: identity + routing info plus the three
 * switches the DBHub design gives every connection — Show as tab (dynamic
 * second-level tab next to Glue Catalog), Enabled for AI (the read-only SQL
 * tool registration) and the read-only policy label. Edit opens the connection
 * form (batch 3).
 */
export function ConnectionCard({
  connection,
  profiles,
  onEdit
}: {
  connection: DbConnection;
  profiles: NetworkProfile[];
  onEdit?: (connection: DbConnection) => void;
}) {
  const setFlags = useSetDbConnectionFlags();

  const update = (flags: { showAsTab?: boolean; enabledForAi?: boolean }) => {
    setFlags.mutate(
      { connectionId: connection.id, flags },
      {
        onSuccess: (updated) => {
          const parts: string[] = [];
          if (flags.showAsTab !== undefined) {
            parts.push(flags.showAsTab ? "pinned to tabs" : "removed from tabs");
          }
          if (flags.enabledForAi !== undefined) {
            parts.push(flags.enabledForAi ? "enabled for AI" : "disabled for AI");
          }
          toast.success(`${updated.name}: ${parts.join(", ")}.`);
        },
        onError: (error) => toast.error(formatAppError(error, "Failed to update connection."))
      }
    );
  };

  const profile = profiles.find((entry) => entry.id === connection.networkProfileId);
  const kindLabel = connection.kind === "yellowbrick" ? "Yellowbrick" : connection.kind === "mysql" ? "MySQL" : "PostgreSQL";

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-medium">{connection.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {kindLabel} · {connection.host}:{connection.port}
              {connection.database ? ` · ${connection.database}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline" className="text-xs">
            {connection.enabledForAi ? "AI read-only" : "Manual"}
          </Badge>
          {onEdit ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Edit ${connection.name}`}
                  onClick={() => onEdit(connection)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit connection</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>Network:</dt>
          <dd>{profile ? `${profile.name} (${profile.transport.type})` : "Direct connection"}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Auth:</dt>
          <dd>{connection.username}</dd>
        </div>
      </dl>

      <div className="mt-4 space-y-3 border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`tab-${connection.id}`} className="text-sm font-normal">
            Show as tab
          </Label>
          <Switch
            id={`tab-${connection.id}`}
            checked={connection.showAsTab}
            disabled={setFlags.isPending}
            onCheckedChange={(checked) => update({ showAsTab: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label htmlFor={`ai-${connection.id}`} className="text-sm font-normal">
              Enabled for AI
            </Label>
            <p className="text-xs text-muted-foreground">
              Read-only SQL tool ({connection.aiReadOnlyPolicy})
            </p>
          </div>
          <Switch
            id={`ai-${connection.id}`}
            checked={connection.enabledForAi}
            disabled={setFlags.isPending}
            onCheckedChange={(checked) => update({ enabledForAi: checked })}
          />
        </div>
      </div>
    </div>
  );
}
