import { useState } from "react";
import { CircleCheck, CircleX, LoaderCircle, Pencil, Plug, Trash2 } from "lucide-react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DbKindIcon, dbKindLabel } from "@/components/dbhub/DbKindIcon";
import { useSetDbConnectionFlags, useTestDbConnection } from "@/hooks/useDbHub";
import { useT } from "@/i18n";
import { formatAppError } from "@/services/appErrorMessage";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { DbConnection, DbConnectionFlags, DbTestResult, NetworkProfile } from "@/types/domain";

/**
 * One connection on the Overview board: identity + routing info plus the three
 * switches the DBHub design gives every connection — Show as tab (dynamic
 * second-level tab next to Glue Catalog), Enabled for AI (the read-only SQL
 * tool registration) and the read-only policy label. Edit opens the connection
 * form (batch 3). Test dials the saved connection in place, so checking that a
 * connection still works never means opening the form and closing it again.
 */
export function ConnectionCard({
  connection,
  profiles,
  onEdit,
  onDelete
}: {
  connection: DbConnection;
  profiles: NetworkProfile[];
  onEdit?: (connection: DbConnection) => void;
  onDelete?: (connection: DbConnection) => void;
}) {
  const t = useT();
  const setFlags = useSetDbConnectionFlags();
  const testConnection = useTestDbConnection();
  const [testResult, setTestResult] = useState<DbTestResult>();

  /**
   * Probe the saved connection and keep the answer on the card. The toast is
   * the notification; the line below is what is still there when it has faded.
   */
  const test = () => {
    setTestResult(undefined);
    testConnection.mutate(connection.id, {
      onSuccess: (result) => {
        setTestResult(result);
        if (result.ok) {
          toast.success(`${result.message} (${result.latencyMs}ms)`);
        } else {
          toast.error(result.message);
        }
      },
      onError: (error) => toast.error(formatAppError(error, "Test failed."))
    });
  };

  const update = (flags: DbConnectionFlags) => {
    setFlags.mutate(
      { connectionId: connection.id, flags },
      {
        onSuccess: (updated) => {
          const parts: string[] = [];
          if (flags.showAsTab !== undefined) {
            parts.push(t(flags.showAsTab ? "pinned to tabs" : "removed from tabs"));
          }
          if (flags.enabledForAi !== undefined) {
            parts.push(t(flags.enabledForAi ? "enabled for AI" : "disabled for AI"));
          }
          toast.success(t("{name}: {items}.", { name: updated.name, items: parts.join(", ") }));
        },
        onError: (error) => toast.error(formatAppError(error, "Failed to update connection."))
      }
    );
  };

  const profile = profiles.find((entry) => entry.id === connection.networkProfileId);
  const kindLabel = dbKindLabel(connection.kind);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <DbKindIcon kind={connection.kind} className="size-4" />
          <div className="min-w-0">
            <p className="truncate font-medium">{connection.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {kindLabel} · {connection.host}:{connection.port}
              {connection.database ? ` · ${connection.database}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/*
            "Read-only" is a promise this app can only partly keep, so the badge
            says how it is kept: statements are classified, not sandboxed. The
            tooltip is the one place that caveat has room, and it ends on the
            thing that actually holds — the account's own permissions.
          */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(badgeVariants({ variant: "outline" }), "cursor-help")}
                tabIndex={0}
              >
                {t(connection.enabledForAi ? "AI read-only" : "Manual")}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {connection.enabledForAi
                ? t(
                    "Read-only by rule, not by guarantee: each statement is classified as a read or refused, and the session opens in read-only mode. The check judges a statement's shape, so a statement that slips through still runs — grant the database account read-only permissions for protection that holds."
                  )
                : t(
                    "No read-only SQL tool is registered for the AI on this connection: only you can run queries on it."
                  )}
            </TooltipContent>
          </Tooltip>
          {/*
            Just "SM" — the secret's name is unbounded user text, and spelling
            it out here pushes this row past the card's width. The full name
            stays one hover away, and the form shows it in full.
          */}
          <Badge
            variant="secondary"
            className="shrink-0 text-xs"
            title={
              connection.authMode === "aws_secret"
                ? connection.secretName ?? connection.secretArn?.split(":").pop()
                : t("Local password")
            }
          >
            {t(connection.authMode === "aws_secret" ? "SM" : "Local password")}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("Test {name}", { name: connection.name })}
                disabled={testConnection.isPending}
                onClick={test}
              >
                {testConnection.isPending ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Plug className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Test connection")}</TooltipContent>
          </Tooltip>
          {onDelete ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  aria-label={t("Delete {name}", { name: connection.name })}
                  onClick={() => onDelete(connection)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("Delete connection")}</TooltipContent>
            </Tooltip>
          ) : null}
          {onEdit ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("Edit {name}", { name: connection.name })}
                  onClick={() => onEdit(connection)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("Edit connection")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>{t("Network:")}</dt>
          <dd>{profile ? `${profile.name} (${profile.transport.type})` : t("Direct connection")}</dd>
        </div>
        <div className="flex gap-1">
          <dt>{t("Auth:")}</dt>
          <dd>{connection.username}</dd>
        </div>
      </dl>

      {testResult ? (
        <p
          className={cn(
            "mt-2 flex items-start gap-1.5 text-xs",
            testResult.ok ? "text-green-600 dark:text-green-500" : "text-destructive"
          )}
        >
          {testResult.ok ? (
            <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <CircleX className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">
            {testResult.message}
            {testResult.ok ? ` (${testResult.latencyMs} ms)` : ""}
          </span>
        </p>
      ) : null}

      <div className="mt-4 space-y-3 border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`tab-${connection.id}`} className="text-sm font-normal">
            {t("Show as tab")}
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
            <Label htmlFor={`writes-${connection.id}`} className="text-sm font-normal">
              {t("Allow writes")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("Your own queries may modify this database — the AI still cannot")}
            </p>
          </div>
          <Switch
            id={`writes-${connection.id}`}
            checked={connection.allowWrites}
            disabled={setFlags.isPending}
            onCheckedChange={(checked) => update({ allowWrites: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label htmlFor={`ai-${connection.id}`} className="text-sm font-normal">
              {t("Enabled for AI")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("Read-only SQL tool")} ({connection.aiReadOnlyPolicy})
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
