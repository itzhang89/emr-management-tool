import { Fragment, useMemo, useState, type MouseEvent } from "react";
import {
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  useCreateSecret,
  useDeleteSecret,
  useGetSecretValue,
  useSecrets,
  useUpdateSecret
} from "@/hooks/useSecrets";
import { useT } from "@/i18n";
import { formatAppError } from "@/services/appErrorMessage";
import { firstLevelSecretFields } from "@/services/secretJson";
import type { SecretSummary } from "@/types/domain";
import { cn } from "@/lib/utils";

const MASK = "••••••••";
const DEFAULT_RECOVERY_DAYS = 7;

export type SecretKvPair = { id: string; key: string; value: string };

function newPairId(): string {
  return crypto.randomUUID();
}

/** Default DB credential fields for a new secret. */
export function defaultSecretKvPairs(): SecretKvPair[] {
  return [
    { id: newPairId(), key: "username", value: "" },
    { id: newPairId(), key: "password", value: "" },
    { id: newPairId(), key: "host", value: "" },
    { id: newPairId(), key: "port", value: "3306" },
    { id: newPairId(), key: "database", value: "" }
  ];
}

/** Aggregate first-level key/value rows into a JSON object string for the API. */
export function pairsToSecretJson(pairs: SecretKvPair[]): string {
  const object: Record<string, unknown> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!key) continue;
    const trimmed = pair.value.trim();
    if (key === "port" && /^-?\d+$/.test(trimmed)) {
      object[key] = Number(trimmed);
    } else {
      object[key] = pair.value;
    }
  }
  return JSON.stringify(object);
}

/** Load first-level fields from a SecretString into editable pairs. */
export function pairsFromSecretJson(raw: string): SecretKvPair[] {
  const parsed = firstLevelSecretFields(raw);
  if (parsed.kind === "object") {
    if (parsed.fields.length === 0) return defaultSecretKvPairs();
    return parsed.fields.map((field) => ({
      id: newPairId(),
      key: field.key,
      value: field.value
    }));
  }
  return [{ id: newPairId(), key: "value", value: parsed.value }];
}

function suggestCloneName(name: string): string {
  const base = name.trim() || "secret";
  return `${base}-copy`;
}

function tagValue(secret: SecretSummary, key: string): string | undefined {
  return secret.tags.find((tag) => tag.key === key)?.value;
}

function isOwnedBy(secret: SecretSummary, submitUser: string | undefined): boolean {
  if (!submitUser) return false;
  return tagValue(secret, "submitUser") === submitUser;
}

type FormMode = "create" | "edit" | "clone";

export function SecretsPage() {
  const t = useT();
  const activeAccount = useActiveAwsAccount();
  const submitUser = useSubmitUser();
  const secretsQuery = useSecrets();
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();
  const getSecretValue = useGetSecretValue();

  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [formSecret, setFormSecret] = useState<SecretSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SecretSummary | null>(null);
  const [expandedArn, setExpandedArn] = useState<string | null>(null);
  const [expandedRaw, setExpandedRaw] = useState<string | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pairs, setPairs] = useState<SecretKvPair[]>(() => defaultSecretKvPairs());

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

  const resetForm = () => {
    setFormMode(null);
    setFormSecret(null);
    setName("");
    setDescription("");
    setPairs(defaultSecretKvPairs());
  };

  const openCreate = () => {
    setFormMode("create");
    setFormSecret(null);
    setName("");
    setDescription("");
    setPairs(defaultSecretKvPairs());
  };

  const openEdit = async (secret: SecretSummary, event: MouseEvent) => {
    event.stopPropagation();
    if (!isOwnedBy(secret, submitUser.data)) {
      toast.error(t("Only the owner can edit this secret."));
      return;
    }
    try {
      const { value } = await getSecretValue.mutateAsync(secret.arn);
      setFormMode("edit");
      setFormSecret(secret);
      setName(secret.name);
      setDescription(secret.description ?? "");
      setPairs(pairsFromSecretJson(value));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to load secret value."));
    }
  };

  const openClone = async (secret: SecretSummary, event: MouseEvent) => {
    event.stopPropagation();
    try {
      const { value } = await getSecretValue.mutateAsync(secret.arn);
      setFormMode("clone");
      setFormSecret(secret);
      setName(suggestCloneName(secret.name));
      setDescription(secret.description ?? "");
      setPairs(pairsFromSecretJson(value));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to load secret value."));
    }
  };

  const validatePairs = (): string | null => {
    const keys = pairs.map((pair) => pair.key.trim()).filter(Boolean);
    if (keys.length === 0) {
      return t("Add at least one key.");
    }
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        return t('Duplicate key "{key}".', { key });
      }
      seen.add(key);
    }
    return null;
  };

  const handleSubmitForm = async () => {
    if (!formMode) return;
    if (formMode !== "edit" && !name.trim()) {
      toast.error(t("Secret name is required."));
      return;
    }
    const pairError = validatePairs();
    if (pairError) {
      toast.error(pairError);
      return;
    }
    const secretString = pairsToSecretJson(pairs);

    try {
      if (formMode === "edit" && formSecret) {
        await updateSecret.mutateAsync({
          secretId: formSecret.arn,
          secretString,
          description: description.trim()
        });
        toast.success(t('Secret "{name}" updated.', { name: formSecret.name }));
        if (expandedArn === formSecret.arn) {
          setExpandedRaw(secretString);
          setRevealedKeys(new Set());
        }
      } else {
        const createdName = name.trim();
        await createSecret.mutateAsync({
          name: createdName,
          description: description.trim() || undefined,
          secretString
        });
        toast.success(
          formMode === "clone"
            ? t('Secret "{name}" cloned.', { name: createdName })
            : t('Secret "{name}" created.', { name: createdName })
        );
      }
      resetForm();
    } catch (error) {
      toast.error(
        formatAppError(
          error,
          formMode === "edit"
            ? "Failed to update secret."
            : formMode === "clone"
              ? "Failed to clone secret."
              : "Failed to create secret."
        )
      );
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      const result = await deleteSecret.mutateAsync({
        secretId: pendingDelete.arn,
        recoveryWindowInDays: DEFAULT_RECOVERY_DAYS
      });
      toast.success(
        t('Secret "{name}" scheduled for deletion (recovery window {days} days).', {
          name: result.name,
          days: DEFAULT_RECOVERY_DAYS
        })
      );
      if (expandedArn === pendingDelete.arn) {
        setExpandedArn(null);
        setExpandedRaw(null);
      }
      setPendingDelete(null);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to delete secret."));
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

  const updatePair = (id: string, patch: Partial<Pick<SecretKvPair, "key" | "value">>) => {
    setPairs((prev) => prev.map((pair) => (pair.id === id ? { ...pair, ...patch } : pair)));
  };

  const removePair = (id: string) => {
    setPairs((prev) => (prev.length <= 1 ? prev : prev.filter((pair) => pair.id !== id)));
  };

  const addPair = () => {
    setPairs((prev) => [...prev, { id: newPairId(), key: "", value: "" }]);
  };

  const formBusy = createSecret.isPending || updateSecret.isPending || getSecretValue.isPending;
  const formTitle =
    formMode === "edit"
      ? t("Edit Secret")
      : formMode === "clone"
        ? t("Clone Secret")
        : t("Create Secret");

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
            <Button type="button" size="sm" onClick={openCreate}>
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
              <th className="w-36 px-3 py-2 font-medium">{t("Actions")}</th>
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
                const owned = isOwnedBy(secret, submitUser.data);
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
                        <div className="flex items-center gap-0.5">
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={t("Clone secret")}
                                disabled={getSecretValue.isPending}
                                onClick={(event) => void openClone(secret, event)}
                              >
                                <CopyPlus className="size-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("Clone secret")}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label={t("Edit secret")}
                                  disabled={!owned || getSecretValue.isPending}
                                  onClick={(event) => void openEdit(secret, event)}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {owned
                                ? t("Edit secret")
                                : t("Only the owner (matching submitUser) can edit or delete.")}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive hover:text-destructive"
                                  aria-label={t("Delete secret")}
                                  disabled={!owned || deleteSecret.isPending}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setPendingDelete(secret);
                                  }}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {owned
                                ? t("Delete secret")
                                : t("Only the owner (matching submitUser) can edit or delete.")}
                            </TooltipContent>
                          </Tooltip>
                        </div>
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
        open={formMode !== null}
        onOpenChange={(open) => {
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{formTitle}</DialogTitle>
            <DialogDescription>
              {formMode === "edit" ? (
                <span className="break-all font-mono text-xs">{formSecret?.arn}</span>
              ) : formMode === "clone" ? (
                t("Creates a new secret from a copy. Tags submitUser and managedBy are added automatically.")
              ) : (
                t(
                  "Creates a secret in the active account region. Tags submitUser and managedBy are added automatically."
                )
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
                disabled={formMode === "edit"}
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
              <div className="flex items-center justify-between gap-2">
                <Label>{t("Fields")}</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addPair}>
                  <Plus className="mr-1 size-3.5" />
                  {t("Add field")}
                </Button>
              </div>
              <div className="space-y-2 rounded-md border p-2">
                {pairs.map((pair) => (
                  <div key={pair.id} className="flex items-center gap-2">
                    <Input
                      value={pair.key}
                      onChange={(event) => updatePair(pair.id, { key: event.target.value })}
                      placeholder={t("Key")}
                      className="h-8 w-[9rem] shrink-0 font-mono text-xs"
                      aria-label={t("Key")}
                    />
                    <Input
                      value={pair.value}
                      onChange={(event) => updatePair(pair.id, { value: event.target.value })}
                      placeholder={t("Value")}
                      className="h-8 min-w-0 flex-1 font-mono text-xs"
                      type={pair.key.trim().toLowerCase() === "password" ? "password" : "text"}
                      aria-label={t("Value")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={t("Remove field")}
                      disabled={pairs.length <= 1}
                      onClick={() => removePair(pair.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("Fields are saved as a JSON object. Empty keys are skipped.")}
              </p>
            </div>
            {formMode !== "edit" ? (
              <p className="text-xs text-muted-foreground">
                {t("Auto tags")}: submitUser={submitUser.data ?? "…"}, managedBy=emr-management-tool
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetForm}>
              {t("Cancel")}
            </Button>
            <Button type="button" onClick={() => void handleSubmitForm()} disabled={formBusy}>
              {formMode === "edit"
                ? t("Save")
                : formMode === "clone"
                  ? t("Clone")
                  : t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Delete secret?")}</DialogTitle>
            <DialogDescription>
              {t(
                '"{name}" will be scheduled for deletion with a {days}-day recovery window. Only secrets tagged with your submitUser can be deleted from this app.',
                { name: pendingDelete?.name ?? "", days: DEFAULT_RECOVERY_DAYS }
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteSecret.isPending}
            >
              {t("Delete")}
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
