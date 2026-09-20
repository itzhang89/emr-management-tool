import { Fragment, useMemo, useState, type MouseEvent } from "react";
import { Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useSubmitUser } from "@/hooks/useJobConfigTemplates";
import { useCreateSecret, useGetSecretValue, useSecrets } from "@/hooks/useSecrets";
import { useT } from "@/i18n";
import { formatAppError } from "@/services/appErrorMessage";
import type { SecretSummary } from "@/types/domain";
import { cn } from "@/lib/utils";

const JSON_TEMPLATE = `{
  "username": "",
  "password": "",
  "host": "",
  "port": 3306,
  "database": ""
}`;

const MASK = "••••••••";

function tagValue(secret: SecretSummary, key: string): string | undefined {
  return secret.tags.find((tag) => tag.key === key)?.value;
}

/** First-level JSON object entries only; non-objects become a single synthetic field. */
export function firstLevelSecretFields(
  raw: string
): { kind: "object"; fields: { key: string; value: string }[] } | { kind: "raw"; value: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const fields = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        key,
        value:
          value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : JSON.stringify(value)
      }));
      return { kind: "object", fields };
    }
  } catch {
    // fall through
  }
  return { kind: "raw", value: raw };
}

export function SecretsPage() {
  const t = useT();
  const activeAccount = useActiveAwsAccount();
  const submitUser = useSubmitUser();
  const secretsQuery = useSecrets();
  const createSecret = useCreateSecret();
  const getSecretValue = useGetSecretValue();

  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  /** ARN of the expanded row. */
  const [expandedArn, setExpandedArn] = useState<string | null>(null);
  /** Fetched SecretString for the expanded row. */
  const [expandedRaw, setExpandedRaw] = useState<string | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  /** Keys whose values are currently revealed (within the expanded row). */
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [secretString, setSecretString] = useState(JSON_TEMPLATE);

  const secrets = secretsQuery.data ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return secrets.filter((secret) => {
      if (mineOnly && tagValue(secret, "submitUser") !== submitUser.data) {
        return false;
      }
      if (!needle) return true;
      return (
        secret.name.toLowerCase().includes(needle) ||
        secret.arn.toLowerCase().includes(needle) ||
        (secret.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [secrets, search, mineOnly, submitUser.data]);

  const expandedFields = useMemo(
    () => (expandedRaw === null ? null : firstLevelSecretFields(expandedRaw)),
    [expandedRaw]
  );

  const resetCreate = () => {
    setName("");
    setDescription("");
    setSecretString(JSON_TEMPLATE);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("Secret name is required."));
      return;
    }
    try {
      JSON.parse(secretString);
    } catch {
      toast.error(t("Secret value must be valid JSON."));
      return;
    }
    try {
      await createSecret.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        secretString
      });
      toast.success(t('Secret "{name}" created.', { name: name.trim() }));
      setCreateOpen(false);
      resetCreate();
    } catch (error) {
      toast.error(formatAppError(error, "Failed to create secret."));
    }
  };

  const copyText = async (text: string, successLabel?: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(successLabel ?? t("Copied to clipboard"));
  };

  const copyWholeSecret = async (secret: SecretSummary, event: MouseEvent) => {
    event.stopPropagation();
    try {
      const { value } = await getSecretValue.mutateAsync(secret.arn);
      await copyText(value, t("Copied entire secret"));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to copy secret value."));
    }
  };

  const copyFieldValue = async (value: string, key: string, event: MouseEvent) => {
    event.stopPropagation();
    try {
      await copyText(value, t('Copied "{key}"', { key }));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to copy secret value."));
    }
  };

  const toggleRevealKey = (key: string, event: MouseEvent) => {
    event.stopPropagation();
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleExpand = async (secret: SecretSummary) => {
    if (expandedArn === secret.arn) {
      setExpandedArn(null);
      setExpandedRaw(null);
      setRevealedKeys(new Set());
      return;
    }
    setExpandedArn(secret.arn);
    setExpandedRaw(null);
    setRevealedKeys(new Set());
    setExpandLoading(true);
    try {
      const { value } = await getSecretValue.mutateAsync(secret.arn);
      setExpandedRaw(value);
    } catch (error) {
      setExpandedArn(null);
      toast.error(formatAppError(error, "Failed to load secret value."));
    } finally {
      setExpandLoading(false);
    }
  };

  if (!activeAccount.data) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader pageId="secrets" />
        <p className="text-sm text-muted-foreground">
          {t("No active account. Configure Settings first.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        pageId="secrets"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => secretsQuery.refetch()}
              disabled={secretsQuery.isFetching}
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${secretsQuery.isFetching ? "animate-spin" : ""}`} />
              {t("Refresh")}
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-3.5" />
              {t("Create Secret")}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          {activeAccount.data.name} · {activeAccount.data.region}
        </span>
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Search by name or ARN")}
            className="h-9 pl-8"
          />
        </div>
        <label className="flex items-center gap-2">
          <Checkbox checked={mineOnly} onCheckedChange={(value) => setMineOnly(value === true)} />
          <span>{t("Mine only")}</span>
        </label>
      </div>

      {secretsQuery.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {formatAppError(secretsQuery.error, "Failed to list secrets.")}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("Name")}</th>
              <th className="px-3 py-2 font-medium">{t("Description")}</th>
              <th className="px-3 py-2 font-medium">{t("Tags")}</th>
              <th className="px-3 py-2 font-medium">{t("Last changed")}</th>
              <th className="w-12 px-3 py-2 font-medium">{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {secretsQuery.isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  {t("Loading secrets…")}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  {t("No secrets in this account region yet.")}
                </td>
              </tr>
            ) : (
              filtered.map((secret) => {
                const owner = tagValue(secret, "submitUser");
                const isExpanded = expandedArn === secret.arn;
                return (
                  <Fragment key={secret.arn}>
                    <tr
                      className={cn(
                        "cursor-pointer border-b last:border-0 hover:bg-muted/30",
                        isExpanded && "bg-muted/20"
                      )}
                      onClick={() => void toggleExpand(secret)}
                    >
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 font-medium">
                          <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                          {secret.name}
                        </span>
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-muted-foreground">
                        {secret.description || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {owner ? (
                            <Badge variant="outline" className="text-xs">
                              submitUser={owner}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              {t("untagged")}
                            </Badge>
                          )}
                          {tagValue(secret, "managedBy") ? (
                            <Badge variant="outline" className="text-xs">
                              managedBy
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {secret.lastChangedDate
                          ? new Date(secret.lastChangedDate).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={t("Copy entire secret")}
                              disabled={getSecretValue.isPending}
                              onClick={(event) => void copyWholeSecret(secret, event)}
                            >
                              <Copy className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("Copy entire secret")}</TooltipContent>
                        </Tooltip>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-b bg-muted/10 last:border-0">
                        <td colSpan={5} className="px-3 py-3">
                          {expandLoading || expandedRaw === null || expandedFields === null ? (
                            <p className="text-sm text-muted-foreground">{t("Loading secret fields…")}</p>
                          ) : expandedFields.kind === "raw" ? (
                            <SecretFieldRow
                              fieldKey="value"
                              displayValue={expandedFields.value}
                              revealed={revealedKeys.has("value")}
                              onToggleReveal={(event) => toggleRevealKey("value", event)}
                              onCopy={(event) =>
                                void copyFieldValue(expandedFields.value, "value", event)
                              }
                              t={t}
                            />
                          ) : expandedFields.fields.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("Empty JSON object.")}</p>
                          ) : (
                            <ul className="divide-y rounded-md border bg-background">
                              {expandedFields.fields.map((field) => (
                                <li key={field.key}>
                                  <SecretFieldRow
                                    fieldKey={field.key}
                                    displayValue={field.value}
                                    revealed={revealedKeys.has(field.key)}
                                    onToggleReveal={(event) => toggleRevealKey(field.key, event)}
                                    onCopy={(event) =>
                                      void copyFieldValue(field.value, field.key, event)
                                    }
                                    t={t}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {t("Showing first-level JSON keys only. Nested values are stringified.")}
                          </p>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreate();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Create Secret")}</DialogTitle>
            <DialogDescription>
              {t(
                "Creates a secret in the active account region. Tags submitUser and managedBy are added automatically."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="secret-name">{t("Name")}</Label>
              <Input
                id="secret-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="mysql.sales_ro"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secret-description">{t("Description")}</Label>
              <Input
                id="secret-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="secret-value">{t("Value (JSON)")}</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSecretString(JSON_TEMPLATE)}>
                  {t("Insert template")}
                </Button>
              </div>
              <Textarea
                id="secret-value"
                value={secretString}
                onChange={(event) => setSecretString(event.target.value)}
                className="min-h-[10rem] font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Auto tags")}: submitUser={submitUser.data ?? "…"}, managedBy=emr-management-tool
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button type="button" onClick={handleCreate} disabled={createSecret.isPending}>
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SecretFieldRow({
  fieldKey,
  displayValue,
  revealed,
  onToggleReveal,
  onCopy,
  t
}: {
  fieldKey: string;
  displayValue: string;
  revealed: boolean;
  onToggleReveal: (event: MouseEvent) => void;
  onCopy: (event: MouseEvent) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="w-36 shrink-0 truncate font-mono text-xs font-medium" title={fieldKey}>
        {fieldKey}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-xs",
          revealed ? "text-foreground" : "text-muted-foreground"
        )}
        title={revealed ? displayValue : undefined}
      >
        {revealed ? displayValue : MASK}
      </span>
      <div className="flex shrink-0 gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={revealed ? t("Hide value") : t("Reveal value")}
              onClick={onToggleReveal}
            >
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{revealed ? t("Hide value") : t("Reveal value")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('Copy "{key}"', { key: fieldKey })}
              onClick={onCopy}
            >
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('Copy "{key}"', { key: fieldKey })}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
