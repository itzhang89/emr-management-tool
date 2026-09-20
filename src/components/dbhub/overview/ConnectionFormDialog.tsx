import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  useCreateDbConnection,
  useNetworkProfiles,
  useTestDbConnectionDraft,
  useUpdateDbConnection
} from "@/hooks/useDbHub";
import { useT } from "@/i18n";
import { formatAppError } from "@/services/appErrorMessage";
import type { DbAuthMode, DbConnection, DbConnectionKind, DbConnectionTestInput } from "@/types/domain";
import { useSecrets } from "@/hooks/useSecrets";

/**
 * The "Connect to a database" form (design section 5): Server and
 * Authentication groups, Host/URL dual mode, the network profile picker, the
 * read-only AI toggle and the Show-as-tab switch — committed with Save, or
 * probed immediately with Test Connection. Passwords are write-only: a saved
 * one shows as a filled placeholder and can be replaced but never read back.
 */

const KIND_LABELS: Record<DbConnectionKind, string> = {
  mysql: "MySQL",
  postgres: "PostgreSQL",
  yellowbrick: "Yellowbrick"
};

const DEFAULT_PORTS: Record<DbConnectionKind, number> = {
  mysql: 3306,
  postgres: 5432,
  yellowbrick: 5432
};

export function ConnectionFormDialog({
  open,
  onOpenChange,
  connection,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode; absent = create. */
  connection?: DbConnection;
  onSaved?: (connection: DbConnection) => void;
}) {
  const t = useT();
  const createConnection = useCreateDbConnection();
  const updateConnection = useUpdateDbConnection();
  const testDraftConnection = useTestDbConnectionDraft();
  const profilesQuery = useNetworkProfiles();
  const profiles = profilesQuery.data ?? [];
  const secretsQuery = useSecrets();
  const secrets = secretsQuery.data ?? [];

  const [kind, setKind] = useState<DbConnectionKind>(connection?.kind ?? "mysql");
  const [name, setName] = useState(connection?.name ?? "");
  const [connectBy, setConnectBy] = useState<"host" | "url">("host");
  const [url, setUrl] = useState("");
  const [host, setHost] = useState(connection?.host ?? "");
  const [port, setPort] = useState(String(connection?.port ?? DEFAULT_PORTS.mysql));
  const [database, setDatabase] = useState(connection?.database ?? "");
  const [username, setUsername] = useState(connection?.username ?? "");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<DbAuthMode>(connection?.authMode ?? "manual");
  const [secretArn, setSecretArn] = useState(connection?.secretArn ?? "");
  const [networkProfileId, setNetworkProfileId] = useState(connection?.networkProfileId ?? "");
  const [showAsTab, setShowAsTab] = useState(connection?.showAsTab ?? false);
  const [enabledForAi, setEnabledForAi] = useState(connection?.enabledForAi ?? true);

  useEffect(() => {
    if (!open) return;
    setKind(connection?.kind ?? "mysql");
    setName(connection?.name ?? "");
    setConnectBy("host");
    setUrl("");
    setHost(connection?.host ?? "");
    setPort(String(connection?.port ?? DEFAULT_PORTS[connection?.kind ?? "mysql"]));
    setDatabase(connection?.database ?? "");
    setUsername(connection?.username ?? "");
    setPassword("");
    setAuthMode(connection?.authMode ?? "manual");
    setSecretArn(connection?.secretArn ?? "");
    setNetworkProfileId(connection?.networkProfileId ?? "");
    setShowAsTab(connection?.showAsTab ?? false);
    setEnabledForAi(connection?.enabledForAi ?? true);
  }, [open, connection]);

  const transportTypeOf = (profileId: string): string | undefined =>
    profiles.find((profile) => profile.id === profileId)?.transport.type;

  const handleKindChange = (next: DbConnectionKind) => {
    setKind(next);
    if (!connection) setPort(String(DEFAULT_PORTS[next]));
  };

  const validate = (): string | undefined => {
    if (!name.trim()) return "Connection name is required.";
    if (connectBy === "url") {
      if (!url.trim()) return "URL is required.";
      return undefined;
    }
    if (authMode === "manual" && !host.trim()) return "Server host is required.";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      return "Port must be 1-65535.";
    }
    if (authMode === "manual" && !username.trim()) return "Username is required.";
    if (authMode === "aws_secret" && !secretArn.trim()) {
      return "Select an AWS Secrets Manager secret.";
    }
    return undefined;
  };

  const selectedSecret = secrets.find((secret) => secret.arn === secretArn);
  const preferredSecrets = [...secrets].sort((left, right) => {
    const leftPreferred = left.name.startsWith(`${kind}.`) ? 0 : 1;
    const rightPreferred = right.name.startsWith(`${kind}.`) ? 0 : 1;
    return leftPreferred - rightPreferred || left.name.localeCompare(right.name);
  });

  const buildSave = () => ({
    kind,
    name: name.trim(),
    host: host.trim(),
    port: Number(port),
    database: database.trim() || undefined,
    username: username.trim(),
    networkProfileId: networkProfileId || undefined,
    showAsTab,
    enabledForAi,
    authMode,
    secretArn: authMode === "aws_secret" ? secretArn.trim() : connection ? "" : undefined,
    secretName:
      authMode === "aws_secret"
        ? selectedSecret?.name ?? connection?.secretName
        : connection
          ? ""
          : undefined,
    password: authMode === "manual" ? password || undefined : undefined
  });

  /** The form as a probe request. `id` is carried only so editing can reuse
   *  the stored password when this field was left blank. */
  const buildTest = (): DbConnectionTestInput => ({
    id: connection?.id,
    kind,
    host: host.trim(),
    port: Number(port),
    database: database.trim() || undefined,
    username: username.trim(),
    networkProfileId: networkProfileId || undefined,
    password: authMode === "manual" ? password || undefined : undefined,
    authMode,
    secretArn: authMode === "aws_secret" ? secretArn.trim() : undefined
  });

  /**
   * Probe the form's own values. Nothing is written — Test is a read-only act
   * from the user's side, and a test that persisted would leave a connection
   * behind for every click, plus another from the Save that followed.
   */
  const handleTest = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      const result = await testDraftConnection.mutateAsync(buildTest());
      if (result.ok) {
        toast.success(`${result.message} (${result.latencyMs}ms)`);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(formatAppError(error, "Test failed."));
    }
  };

  const handleSave = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      const saved = connection
        ? await updateConnection.mutateAsync({ id: connection.id, ...buildSave() })
        : await createConnection.mutateAsync(buildSave());
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to save connection."));
    }
  };

  const busy =
    createConnection.isPending ||
    updateConnection.isPending ||
    testDraftConnection.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(connection ? "Edit connection" : "Connect to a database")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Settings apply to the active AWS account. Passwords are stored in the system credential store, never in the app database."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-3">
            <Label htmlFor="conn-driver" className="text-right text-sm">{t("Driver")}</Label>
            <select
              id="conn-driver"
              value={kind}
              // The driver decides how the connection is spoken to; changing
              // it on an existing connection would leave its stored credentials
              // and port meaning something else.
              disabled={Boolean(connection)}
              onChange={(event) => handleKindChange(event.target.value as DbConnectionKind)}
              className="h-9 max-w-xs rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {(Object.keys(KIND_LABELS) as DbConnectionKind[]).map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>

            <Label htmlFor="conn-name" className="text-right text-sm">{t("Name")}</Label>
            <Input
              id="conn-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("My MySQL Prod")}
              className="max-w-xs"
            />
          </div>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("Server")}</legend>
            <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-3">
              <Label className="text-right text-sm">{t("Connect by")}</Label>
              <RadioGroup
                value={connectBy}
                onValueChange={(value) => setConnectBy(value as "host" | "url")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="host" id="connect-host" />
                  <Label htmlFor="connect-host" className="text-sm font-normal">{t("Host")}</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="url" id="connect-url" />
                  <Label htmlFor="connect-url" className="text-sm font-normal">URL</Label>
                </div>
              </RadioGroup>

              <Label htmlFor="conn-url" className="text-right text-sm">URL</Label>
              <Input
                id="conn-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={connectBy !== "url"}
                placeholder="jdbc:mysql://localhost:3306/sales"
                className="max-w-sm font-mono text-xs"
              />

              <Label htmlFor="conn-host" className="text-right text-sm">{t("Server Host")}</Label>
              <div className="flex max-w-sm items-center gap-2">
                <Input
                  id="conn-host"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  disabled={connectBy !== "host"}
                  placeholder="10.xx.xx.50"
                  className="flex-1"
                />
                <Label htmlFor="conn-port" className="sr-only">{t("Port")}</Label>
                <Input
                  id="conn-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  disabled={connectBy !== "host"}
                  className="w-24"
                />
              </div>

              <Label htmlFor="conn-database" className="text-right text-sm">{t("Database")}</Label>
              <Input
                id="conn-database"
                value={database}
                onChange={(event) => setDatabase(event.target.value)}
                className="max-w-xs"
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("Authentication")}</legend>
            <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-3">
              <Label className="text-right text-sm">{t("Auth mode")}</Label>
              <RadioGroup
                value={authMode}
                onValueChange={(value) => setAuthMode(value as DbAuthMode)}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="manual" id="auth-manual" />
                  <Label htmlFor="auth-manual" className="text-sm font-normal">
                    {t("Manual password")}
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="aws_secret" id="auth-sm" />
                  <Label htmlFor="auth-sm" className="text-sm font-normal">
                    {t("AWS Secrets Manager")}
                  </Label>
                </div>
              </RadioGroup>

              {authMode === "aws_secret" ? (
                <>
                  <Label htmlFor="conn-secret" className="text-right text-sm">
                    {t("Secret")}
                  </Label>
                  <select
                    id="conn-secret"
                    value={secretArn}
                    onChange={(event) => setSecretArn(event.target.value)}
                    className="h-9 max-w-sm rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">{t("Select a secret…")}</option>
                    {preferredSecrets.map((secret) => (
                      <option key={secret.arn} value={secret.arn}>
                        {secret.name.startsWith(`${kind}.`) ? "★ " : ""}
                        {secret.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}

              <Label htmlFor="conn-username" className="text-right text-sm">{t("Username")}</Label>
              <Input
                id="conn-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="max-w-xs"
                placeholder={
                  authMode === "aws_secret" ? t("Optional fallback — secret may override") : undefined
                }
              />
              {authMode === "manual" ? (
                <>
                  <Label htmlFor="conn-password" className="text-right text-sm">{t("Password")}</Label>
                  <div className="flex max-w-xs items-center gap-2">
                    <Input
                      id="conn-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={connection ? t("•••••••• (saved — leave blank to keep)") : ""}
                    />
                  </div>
                </>
              ) : (
                <p className="col-span-2 text-xs text-muted-foreground">
                  {t(
                    "Password and optional host/user/database come from the bound secret JSON at connect time."
                  )}
                </p>
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("Routing & AI")}</legend>
            <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-3">
              <Label htmlFor="conn-profile" className="text-right text-sm">{t("Network Profile")}</Label>
              <div className="flex max-w-sm items-center gap-2">
                <select
                  id="conn-profile"
                  value={networkProfileId}
                  onChange={(event) => setNetworkProfileId(event.target.value)}
                  className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">{t("(None — direct connection)")}</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.transport.type === "ssh-tunnel" ? "SSH" : "SOCKS5"})
                    </option>
                  ))}
                </select>
              </div>

              <div />
              <div className="flex items-center gap-2">
                <Checkbox
                  id="conn-show-tab"
                  checked={showAsTab}
                  onCheckedChange={(checked) => setShowAsTab(checked === true)}
                />
                <Label htmlFor="conn-show-tab" className="text-sm font-normal">
                  {t("Show as tab (next to Glue Catalog)")}
                </Label>
              </div>

              <div />
              <div className="flex items-center gap-2">
                <Checkbox
                  id="conn-ai"
                  checked={enabledForAi}
                  onCheckedChange={(checked) => setEnabledForAi(checked === true)}
                />
                <Label htmlFor="conn-ai" className="text-sm font-normal">
                  {t("Enable read-only SQL tool for AI")}
                </Label>
              </div>
            </div>
          </fieldset>
        </div>

        <DialogFooter className="mt-2 flex items-center gap-2 sm:justify-between">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handleTest()}>
            {t("Test Connection")}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void handleSave()}>
              {t(connection ? "Save" : "Save and Close")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
