import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSaveNetworkProfile, useTestNetworkProfileDraft } from "@/hooks/useDbHub";
import { useT } from "@/i18n";
import { formatAppError } from "@/services/appErrorMessage";
import type { NetworkProfile } from "@/types/domain";
import { SSH_AUTH_METHODS } from "@/types/domain";
import {
  defaultSocksTransport,
  defaultSshTransport,
  type SocksTransport,
  type SshTransport,
  type TransportKind
} from "./transports";

/**
 * The detail form of one network profile (design section 6). Editing is a
 * local working copy committed with "Apply" — the same commit-the-whole-form
 * model the account dialogs use.
 *
 * SSH Tunnel and Proxy are a choice, not two halves of one profile. The pane
 * nevertheless remembers **both**: switching tabs to look at the other one
 * must not cost what you typed here. Which of the two is in use is not
 * inferred from your typing — each tab carries its own Enabled switch, and the
 * one that is on is the transport the profile routes through. Turning it on
 * turns the other off; turning it off disables the profile.
 */
export function ProfileDetail({ profile }: { profile: NetworkProfile }) {
  const t = useT();
  const saveProfile = useSaveNetworkProfile();
  const testDraftProfile = useTestNetworkProfileDraft();

  const stored = profile.transport;
  const [ssh, setSsh] = useState<SshTransport>(() =>
    stored.type === "ssh-tunnel" ? stored : defaultSshTransport()
  );
  const [socks, setSocks] = useState<SocksTransport>(() =>
    stored.type === "socks5" ? stored : defaultSocksTransport()
  );
  /** Which tab is on screen. Independent of which transport is in use. */
  const [visible, setVisible] = useState<TransportKind>(stored.type);
  /**
   * The transport in use: the one Apply writes. Kept while the profile is
   * disabled so turning its switch back on restores what it carried.
   */
  const [active, setActive] = useState<TransportKind>(stored.type);

  const [name, setName] = useState(profile.name);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [secret, setSecret] = useState("");
  const [dirty, setDirty] = useState(false);

  // A different profile resets the working copy. The parent keys this
  // component by profile id, so this is belt-and-braces rather than the only
  // thing standing between the two profiles.
  useEffect(() => {
    const next = profile.transport;
    setSsh(next.type === "ssh-tunnel" ? next : defaultSshTransport());
    setSocks(next.type === "socks5" ? next : defaultSocksTransport());
    setVisible(next.type);
    setActive(next.type);
    setEnabled(profile.enabled);
    setSecret("");
    setDirty(false);
  }, [profile.id]);

  // A rename from the list is the one change that can arrive while this pane
  // is open. Adopt the name; leave the transport fields — which the user may
  // have edited without applying — exactly as they are.
  useEffect(() => {
    setName(profile.name);
  }, [profile.name]);

  const patchSsh = (patch: Partial<SshTransport>) => {
    setSsh({ ...ssh, ...patch });
    setDirty(true);
  };

  const patchSocks = (patch: Partial<SocksTransport>) => {
    setSocks({ ...socks, ...patch });
    setDirty(true);
  };

  /**
   * Each tab's Enabled switch is the profile's transport choice, so turning
   * one on turns the other off — not by an explicit hand-off but because the
   * other switch is *derived* from `enabled` and `active`. Turning the live
   * one off disables the profile and keeps its transport for the switch back.
   */
  const setUse = (kind: TransportKind, on: boolean) => {
    setDirty(true);
    setEnabled(on);
    if (on) setActive(kind);
  };

  /** Whether a tab's switch reads as on. Only one tab can answer yes. */
  const inUse = (kind: TransportKind) => enabled && active === kind;

  /** The transport this pane will save. */
  const transport = active === "ssh-tunnel" ? ssh : socks;
  const sshAuthMethod = ssh.authMethod;
  const authLabels: Record<string, { secret: string; host: string }> = {
    password: { secret: t("Password"), host: t("Host/IP") },
    "private-key": { secret: t("Key passphrase"), host: t("Host/IP") },
    "ssh-config": { secret: t("Key passphrase (if encrypted)"), host: t("SSH config alias") }
  };
  const labels = authLabels[sshAuthMethod] ?? authLabels.password;

  // Switching between auth modes re-frames what `host` means (IP vs alias),
  // so clear the old value to stop a stray IP becoming a phantom alias.
  const handleAuthChange = (value: string) => {
    const clearingHost = value === "ssh-config" || sshAuthMethod === "ssh-config";
    patchSsh(clearingHost ? { authMethod: value, host: "" } : { authMethod: value });
  };

  const handleApply = () => {
    saveProfile.mutate(
      {
        id: profile.id,
        name,
        transport,
        enabled,
        secret: secret || undefined
      },
      {
        onSuccess: () => {
          setSecret("");
          setDirty(false);
          toast.success(t("Profile applied."));
        },
        onError: (error) => toast.error(formatAppError(error, "Failed to apply profile."))
      }
    );
  };

  const handleTest = async () => {
    // Probe the *working copy*, not the stored profile: what you just typed or
    // toggled is what gets tested. Nothing is written — a test that persisted
    // would commit a half-typed profile and its secret, and would leave the
    // form looking applied when it had only been probed.
    try {
      const result = await testDraftProfile.mutateAsync({
        id: profile.id,
        transport,
        secret: secret || undefined
      });
      if (result.ok) {
        toast.success(`${result.message} (${result.latencyMs}ms)`);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(formatAppError(error, "Profile test failed."));
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm text-muted-foreground">{t("Name")}</span>
        {/* Shown, not edited: renaming happens where the name lives, in the
            list. This line is here so a scrolled-away selection is still
            legible while you edit the transport below. */}
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {t("Double-click the name in the list to rename.")}
        </span>
      </div>
      <Tabs
        value={visible}
        onValueChange={(value) => setVisible(value as TransportKind)}
        className="flex min-h-0 flex-1 flex-col gap-4 p-4"
      >
        <div className="flex shrink-0 items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="ssh-tunnel" className="gap-1.5">
              {t("SSH Tunnel")}
              {inUse("ssh-tunnel") ? <ActiveMark /> : null}
            </TabsTrigger>
            <TabsTrigger value="socks5" className="gap-1.5">
              {t("Proxy")}
              {inUse("socks5") ? <ActiveMark /> : null}
            </TabsTrigger>
          </TabsList>
          {/* One switch, showing the tab you are looking at: turning it on
              makes this transport the profile's and turns the other one off. */}
          <div className="flex items-center gap-2">
            <Label htmlFor={`profile-enabled-${profile.id}`} className="text-sm">
              {t("Enabled")}
            </Label>
            <Switch
              id={`profile-enabled-${profile.id}`}
              checked={inUse(visible)}
              onCheckedChange={(on) => setUse(visible, on)}
            />
          </div>
        </div>

        <TabsContent value="ssh-tunnel" className="mt-0 space-y-4">
          <p className="text-xs text-muted-foreground">
            {t("Forwards database traffic through an SSH server. The database host/port you enter here is the *target* the tunnel opens on the far side.")}
          </p>
          {sshAuthMethod === "ssh-config" ? (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              {t("Alias mode reads")}{" "}
              <code>~/.ssh/config</code>
              {t(": HostName, User, Port, IdentityFile and your existing jump chains come from there — the fields below are ignored except the alias itself. The passphrase field is only used when the config's key file is encrypted.")}
            </p>
          ) : null}
          <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-3">
            <Label htmlFor="ssh-host" className="text-right text-sm">{labels.host}</Label>
            <Input
              id="ssh-host"
              value={ssh.host}
              onChange={(event) => patchSsh({ host: event.target.value })}
              placeholder={sshAuthMethod === "ssh-config" ? "bastion-prod" : "10.xx.xx.50"}
              className="max-w-xs"
            />
            <Label htmlFor="ssh-user" className="text-right text-sm">{t("User Name")}</Label>
            <Input
              id="ssh-user"
              value={ssh.username}
              onChange={(event) => patchSsh({ username: event.target.value })}
              disabled={sshAuthMethod === "ssh-config"}
              className="max-w-xs"
            />
            <Label htmlFor="ssh-auth" className="text-right text-sm">{t("Authentication")}</Label>
            <div>
              <select
                id="ssh-auth"
                value={sshAuthMethod}
                onChange={(event) => handleAuthChange(event.target.value)}
                className="h-9 max-w-xs rounded-md border bg-background px-3 text-sm"
              >
                {SSH_AUTH_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>{method.label}</option>
                ))}
              </select>
            </div>
            {sshAuthMethod === "private-key" || sshAuthMethod === "ssh-config" ? (
              <>
                <Label htmlFor="ssh-key-path" className="text-right text-sm">{t("Key file")}</Label>
                <Input
                  id="ssh-key-path"
                  value={ssh.privateKeyPath ?? ""}
                  onChange={(event) => patchSsh({ privateKeyPath: event.target.value || undefined })}
                  placeholder={sshAuthMethod === "ssh-config" ? "from ~/.ssh/config (IdentityFile)" : "~/.ssh/id_ed25519"}
                  disabled={sshAuthMethod === "ssh-config"}
                  className="max-w-xs font-mono text-xs"
                />
              </>
            ) : null}
            <Label htmlFor="ssh-secret" className="text-right text-sm">{labels.secret}</Label>
            <div className="flex max-w-xs items-center gap-2">
              <Input
                id="ssh-secret"
                type="password"
                value={secret}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setDirty(true);
                }}
                placeholder={ssh.credentialsSaved ? "••••••••" : ""}
              />
            </div>
            <div />
            <div className="flex items-center gap-2">
              <Checkbox
                id="ssh-save-cred"
                checked={ssh.credentialsSaved}
                disabled
                aria-label={t("Save credentials")}
              />
              <Label htmlFor="ssh-save-cred" className="text-sm font-normal text-muted-foreground">
                {t("Save credentials")} {ssh.credentialsSaved ? t("(saved)") : ""}
              </Label>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="socks5" className="mt-0 space-y-4">
          <p className="text-xs text-muted-foreground">
            {t("Dials database hosts through a SOCKS5 proxy.")}
          </p>
          <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-3">
            <Label htmlFor="socks-host" className="text-right text-sm">{t("Host")}</Label>
            <Input
              id="socks-host"
              value={socks.host}
              onChange={(event) => patchSocks({ host: event.target.value })}
              placeholder="127.0.0.1"
              className="max-w-xs"
            />
            <Label htmlFor="socks-port" className="text-right text-sm">{t("Port")}</Label>
            <Input
              id="socks-port"
              type="number"
              min={1}
              max={65535}
              value={socks.port}
              onChange={(event) => patchSocks({ port: Number(event.target.value) || 0 })}
              className="max-w-32"
            />
            <Label htmlFor="socks-user" className="text-right text-sm">{t("User name")}</Label>
            <Input
              id="socks-user"
              value={socks.username ?? ""}
              onChange={(event) => patchSocks({ username: event.target.value || undefined })}
              className="max-w-xs"
            />
            <Label htmlFor="socks-secret" className="text-right text-sm">{t("Password")}</Label>
            <div className="flex max-w-xs items-center gap-2">
              <Input
                id="socks-secret"
                type="password"
                value={secret}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setDirty(true);
                }}
                placeholder={socks.credentialsSaved ? "••••••••" : ""}
              />
            </div>
            <div />
            <div className="flex items-center gap-2">
              <Checkbox
                id="socks-save-cred"
                checked={socks.credentialsSaved}
                disabled
                aria-label={t("Save password/passphrase")}
              />
              <Label htmlFor="socks-save-cred" className="text-sm font-normal text-muted-foreground">
                {t("Save password")} {socks.credentialsSaved ? t("(saved)") : ""}
              </Label>
            </div>
          </div>
        </TabsContent>

        <div className="mt-auto flex shrink-0 items-center justify-between gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" size="sm" onClick={handleTest}>
                  {t(active === "ssh-tunnel" ? "Test tunnel configuration" : "Test proxy configuration")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("Handshake-only; no SQL runs.")}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!dirty || saveProfile.isPending} onClick={handleApply}>
              {t("Apply")}
            </Button>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

/**
 * Marks the tab whose transport Apply will write. `aria-hidden` on purpose:
 * it is a visual cue, not part of the tab's name.
 */
function ActiveMark() {
  const t = useT();
  return (
    <span
      aria-hidden
      className="rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium leading-none text-primary"
    >
      {t("active")}
    </span>
  );
}
