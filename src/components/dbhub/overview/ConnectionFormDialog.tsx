import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { formatAppError } from "@/services/appErrorMessage";
import {
  providedSecretFields,
  readDbSecretPreview,
  secretFieldValue,
  type DbSecretField,
  type DbSecretPreview
} from "@/services/dbSecretPreview";
import type { DbAuthMode, DbConnection, DbConnectionKind, DbConnectionTestInput } from "@/types/domain";
import { useGetSecretValue, useSecrets } from "@/hooks/useSecrets";

/**
 * The "Connect to a database" form (design section 5): Authentication source
 * first — which is where a bound Secrets Manager secret is chosen and where the
 * form says, field by field, whether the secret supplies it — then Server,
 * Authentication and the routing/AI group. Committed with Save, or probed
 * immediately with Test Connection.
 *
 * A bound secret overrides host, port, database, username and password at dial
 * time (Rust applies the overlay, see `credentials::resolve_for_dial`). The form
 * reads the secret's JSON keys so that override is visible: every field the
 * secret supplies is listed as provided and taken out of the form below, and
 * only what it leaves out is asked for. The password is the one value with no
 * fallback here — a typed password is only ever stored to the keychain for a
 * manual connection, so an aws_secret connection whose secret has no password
 * cannot dial, and the form says so rather than offering a field that would not
 * be kept.
 *
 * The dialog clamps itself to the viewport and scrolls its body: the fields are
 * laid out on a two-column grid whose value column is `minmax(0,1fr)`, because a
 * `1fr` track refuses to shrink below its content's min-content width — which is
 * how a long secret name used to push the whole panel off the screen.
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

/**
 * A field the bound secret owns. It keeps its place in the form — so the shape
 * of the connection stays legible — and is greyed out rather than editable. The
 * base Input fades a disabled field to half opacity; these keep full contrast so
 * the value the secret supplies stays readable behind the lock.
 */
const LOCKED_FIELD = "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100";

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
  const getSecretValue = useGetSecretValue();

  const [kind, setKind] = useState<DbConnectionKind>(connection?.kind ?? "mysql");
  const [name, setName] = useState(connection?.name ?? "");
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
  const [preview, setPreview] = useState<DbSecretPreview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  /**
   * One GetSecretValue per ARN per dialog session: toggling back to a secret
   * shows the same panel without asking AWS again. Cleared on open so a secret
   * edited elsewhere is re-read the next time the form is.
   */
  const previewCache = useRef(new Map<string, DbSecretPreview>());

  useEffect(() => {
    if (!open) return;
    setKind(connection?.kind ?? "mysql");
    setName(connection?.name ?? "");
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
    setPreview(undefined);
    setPreviewLoading(false);
    previewCache.current.clear();
  }, [open, connection]);

  /** Carry the secret's own values into the fallback fields, so what is saved
   *  (and what the card shows) is what the dial will really use. The password
   *  never takes this path — it stays in Secrets Manager. */
  const applySecretFields = (next: DbSecretPreview) => {
    if (next.status !== "ok") return;
    const secretHost = secretFieldValue(next, "host");
    const secretPort = secretFieldValue(next, "port");
    const secretDatabase = secretFieldValue(next, "database");
    const secretUsername = secretFieldValue(next, "username");
    if (secretHost) setHost(secretHost);
    if (secretPort) setPort(secretPort);
    if (secretDatabase !== undefined) setDatabase(secretDatabase);
    if (secretUsername) setUsername(secretUsername);
    // A locked field holds nothing. Whatever was typed before the secret was
    // bound is dropped, so the greyed-out password field is not sitting on a
    // value that would still be sent — and still stored — as a fallback.
    if (providedSecretFields(next).has("password")) setPassword("");
  };

  useEffect(() => {
    if (!open) return;
    const arn = secretArn.trim();
    if (authMode !== "aws_secret" || !arn) {
      setPreview(undefined);
      setPreviewLoading(false);
      return;
    }
    const cached = previewCache.current.get(arn);
    if (cached) {
      setPreview(cached);
      setPreviewLoading(false);
      applySecretFields(cached);
      return;
    }

    let cancelled = false;
    setPreview(undefined);
    setPreviewLoading(true);
    void getSecretValue
      .mutateAsync(arn)
      .then(({ value }) => {
        if (cancelled) return;
        const next = readDbSecretPreview(value);
        if (next.status === "ok") previewCache.current.set(arn, next);
        setPreview(next);
        applySecretFields(next);
      })
      .catch(() => {
        // No GetSecretValue permission, a deleted secret, a secret that is not
        // JSON: the form falls back to its own values rather than refusing to
        // go on. The dial still applies whatever the secret holds.
        if (!cancelled) setPreview({ status: "unreadable" });
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `getSecretValue` is a mutation object; its mutateAsync is stable, and
    // re-running on every render would re-dial AWS for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, authMode, secretArn]);

  const handleKindChange = (next: DbConnectionKind) => {
    setKind(next);
    if (!connection) setPort(String(DEFAULT_PORTS[next]));
  };

  const provided = providedSecretFields(preview);
  const previewOk = preview?.status === "ok";
  /** True when the bound secret supplies this field, so the form does not ask. */
  const fromSecret = (key: DbSecretField) => previewOk && provided.has(key);
  const secretBound = authMode === "aws_secret" && secretArn.trim() !== "";

  const portIsValid = () => /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;

  /**
   * Every dial field is required except the database. A secret-backed
   * connection satisfies them from the secret; whatever it leaves out has to be
   * filled in below, and the form says which is which.
   */
  const validate = (): string | undefined => {
    if (!name.trim()) return "Connection name is required.";
    if (authMode === "manual") {
      if (!host.trim()) return "Server host is required.";
      if (!portIsValid()) return "Port must be 1-65535.";
      if (!username.trim()) return "Username is required.";
      // Editing an existing connection may leave this blank to keep the stored
      // password — the only place a blank field still means a password exists.
      if (!connection && !password.trim()) return "Password is required.";
      return undefined;
    }
    if (!secretArn.trim()) return "Select an AWS Secrets Manager secret.";
    // Only a secret we could read can be held to what it does and does not
    // provide; an unreadable one leaves the question to the dialer.
    if (previewOk) {
      if (!fromSecret("host") && !host.trim()) {
        return "Server host is required — the bound secret does not provide one.";
      }
      if (!fromSecret("username") && !username.trim()) {
        return "Username is required — the bound secret does not provide one.";
      }
      if (!fromSecret("password") && !password.trim()) {
        return "Password is required — the bound secret does not provide one.";
      }
    }
    if (!fromSecret("port") && !portIsValid()) return "Port must be 1-65535.";
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
    password: password || undefined
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
    password: password || undefined,
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
    testDraftConnection.isPending ||
    previewLoading;

  /** A locked field shows dots rather than a value it does not hold. */
  const passwordPlaceholder = () => {
    if (fromSecret("password")) return "••••••••";
    if (authMode === "aws_secret") return t("Not in the secret — enter it here");
    if (connection) return t("•••••••• (saved — leave blank to keep)");
    return "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl flex-col">
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

        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto">
          <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
            <Label htmlFor="conn-driver" className="text-right text-sm">{t("Driver")}</Label>
            <select
              id="conn-driver"
              value={kind}
              // The driver decides how the connection is spoken to; changing
              // it on an existing connection would leave its stored credentials
              // and port meaning something else.
              disabled={Boolean(connection)}
              onChange={(event) => handleKindChange(event.target.value as DbConnectionKind)}
              className="h-9 w-full min-w-0 max-w-xs rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
              className="w-full min-w-0 max-w-xs"
            />
          </div>

          {/*
            Authentication source sits above Server because it decides what
            Server and Authentication are even asking for: a bound secret
            overrides those five fields at dial time.
          */}
          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("Authentication source")}</legend>
            <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
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
                  <div className="flex w-full min-w-0 max-w-sm flex-col gap-2">
                    <select
                      id="conn-secret"
                      value={secretArn}
                      onChange={(event) => setSecretArn(event.target.value)}
                      className="h-9 w-full min-w-0 max-w-full rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">{t("Select a secret…")}</option>
                      {preferredSecrets.map((secret) => (
                        <option key={secret.arn} value={secret.arn}>
                          {secret.name.startsWith(`${kind}.`) ? "★ " : ""}
                          {secret.name}
                        </option>
                      ))}
                    </select>
                    {secrets.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "No secrets in this account yet — create one on the Secrets page, then bind it here."
                        )}
                      </p>
                    ) : null}
                    {/*
                      No field-by-field listing: the locked fields below say
                      which values the secret owns, and what a secret carries is
                      its own business. Only the two states the form itself
                      cannot show get a line — that it is still reading, and
                      that it could not read at all.
                    */}
                    {secretBound && previewLoading ? (
                      <p className="text-xs text-muted-foreground">{t("Reading secret…")}</p>
                    ) : null}
                    {secretBound && !previewLoading && preview?.status === "unreadable" ? (
                      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                        {t(
                          "Could not read this secret's fields — fill the values below. The secret still supplies them at connect time."
                        )}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("Server")}</legend>
            <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
              <Label htmlFor="conn-host" className="text-right text-sm">{t("Server Host")}</Label>
              <div className="flex w-full min-w-0 max-w-sm items-center gap-2">
                <Input
                  id="conn-host"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  disabled={fromSecret("host")}
                  placeholder="10.xx.xx.50"
                  className={cn("min-w-0 flex-1", fromSecret("host") && LOCKED_FIELD)}
                />
                <Label htmlFor="conn-port" className="sr-only">{t("Port")}</Label>
                <Input
                  id="conn-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  disabled={fromSecret("port")}
                  className={cn("w-24 shrink-0", fromSecret("port") && LOCKED_FIELD)}
                />
              </div>

              <Label htmlFor="conn-database" className="text-right text-sm">
                {t("Database")}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {t("(optional)")}
                </span>
              </Label>
              <Input
                id="conn-database"
                value={database}
                onChange={(event) => setDatabase(event.target.value)}
                disabled={fromSecret("database")}
                className={cn("w-full min-w-0 max-w-xs", fromSecret("database") && LOCKED_FIELD)}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("Authentication")}</legend>
            <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
              <Label htmlFor="conn-username" className="text-right text-sm">{t("Username")}</Label>
              <Input
                id="conn-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={fromSecret("username")}
                className={cn("w-full min-w-0 max-w-xs", fromSecret("username") && LOCKED_FIELD)}
                placeholder={
                  authMode === "aws_secret" && !fromSecret("username")
                    ? t("Not in the secret — enter it here")
                    : undefined
                }
              />

              <Label htmlFor="conn-password" className="text-right text-sm">{t("Password")}</Label>
              <Input
                id="conn-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={fromSecret("password")}
                className={cn("w-full min-w-0 max-w-xs", fromSecret("password") && LOCKED_FIELD)}
                placeholder={passwordPlaceholder()}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("Routing & AI")}</legend>
            <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
              <Label htmlFor="conn-profile" className="text-right text-sm">{t("Network Profile")}</Label>
              <div className="flex w-full min-w-0 max-w-sm items-center gap-2">
                <select
                  id="conn-profile"
                  value={networkProfileId}
                  onChange={(event) => setNetworkProfileId(event.target.value)}
                  className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
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
