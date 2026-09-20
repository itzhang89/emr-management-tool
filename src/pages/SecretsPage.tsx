import { useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const JSON_TEMPLATE = `{
  "username": "",
  "password": "",
  "host": "",
  "port": 3306,
  "database": ""
}`;

function tagValue(secret: SecretSummary, key: string): string | undefined {
  return secret.tags.find((tag) => tag.key === key)?.value;
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
  const [selected, setSelected] = useState<SecretSummary | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

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

  const copyValue = async (secret: SecretSummary) => {
    try {
      const { value } = await getSecretValue.mutateAsync(secret.arn);
      await navigator.clipboard.writeText(value);
      toast.success(t("Copied to clipboard"));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to copy secret value."));
    }
  };

  const toggleReveal = async (secret: SecretSummary) => {
    if (revealed !== null && selected?.arn === secret.arn) {
      setRevealed(null);
      return;
    }
    try {
      const { value } = await getSecretValue.mutateAsync(secret.arn);
      setRevealed(value);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to reveal secret value."));
    }
  };

  const openDetail = (secret: SecretSummary) => {
    setSelected(secret);
    setRevealed(null);
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
              <th className="px-3 py-2 font-medium">{t("Actions")}</th>
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
                return (
                  <tr key={secret.arn} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 font-medium hover:underline"
                        onClick={() => openDetail(secret)}
                      >
                        <KeyRound className="size-3.5 text-muted-foreground" />
                        {secret.name}
                      </button>
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
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => openDetail(secret)}>
                          {t("View")}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => copyValue(secret)}>
                          {t("Copy")}
                        </Button>
                      </div>
                    </td>
                  </tr>
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

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setRevealed(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription className="break-all font-mono text-xs">{selected.arn}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p>
                  <span className="text-muted-foreground">{t("Description")}: </span>
                  {selected.description || "—"}
                </p>
                <div className="flex flex-wrap gap-1">
                  {selected.tags.length === 0 ? (
                    <Badge variant="secondary">{t("untagged")}</Badge>
                  ) : (
                    selected.tags.map((tag) => (
                      <Badge key={`${tag.key}:${tag.value}`} variant="outline">
                        {tag.key}={tag.value}
                      </Badge>
                    ))
                  )}
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("Secret value")}
                    </span>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => copyValue(selected)}>
                        {t("Copy")}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => toggleReveal(selected)}>
                        {revealed !== null ? (
                          <>
                            <EyeOff className="mr-1 size-3.5" />
                            {t("Hide")}
                          </>
                        ) : (
                          <>
                            <Eye className="mr-1 size-3.5" />
                            {t("Reveal")}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
                    {revealed ?? "••••••••"}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
