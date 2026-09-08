import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSaveNetworkProfile, useTestNetworkProfile } from "@/hooks/useDbHub";
import { formatAppError } from "@/services/appErrorMessage";
import type { NetworkProfile, NetworkTransport } from "@/types/domain";
import { SSH_AUTH_METHODS } from "@/types/domain";

/**
 * The detail form of one network profile (design section 6). Editing is a
 * local working copy committed with "Apply and Close" — the same commit-the-
 * whole-form model the account dialogs use. The SSH Tunnel | Proxy tabs swap
 * which transport this profile carries; switching tabs rewrites the transport
 * kind with that view's default fields.
 */
export function ProfileDetail({ profile }: { profile: NetworkProfile }) {
  const saveProfile = useSaveNetworkProfile();
  const testProfile = useTestNetworkProfile();

  const [name, setName] = useState(profile.name);
  const [transport, setTransport] = useState<NetworkTransport>(profile.transport);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [secret, setSecret] = useState("");
  const [dirty, setDirty] = useState(false);

  // Reset the working copy when a different profile is selected (the parent
  // keys this component by profile id, so this only fires on real switches).
  useEffect(() => {
    setName(profile.name);
    setTransport(profile.transport);
    setEnabled(profile.enabled);
    setSecret("");
    setDirty(false);
  }, [profile]);

  const patchTransport = (patch: Partial<Extract<NetworkTransport, { type: "ssh-tunnel" }>>) => {
    if (transport.type !== "ssh-tunnel") return;
    setTransport({ ...transport, ...patch });
    setDirty(true);
  };

  const patchSocks = (patch: Partial<Extract<NetworkTransport, { type: "socks5" }>>) => {
    if (transport.type !== "socks5") return;
    setTransport({ ...transport, ...patch });
    setDirty(true);
  };

  const switchKind = (kind: NetworkTransport["type"]) => {
    if (transport.type === kind) return;
    setTransport(
      kind === "ssh-tunnel"
        ? {
            type: "ssh-tunnel",
            host: transport.host,
            port: 22,
            username: "root",
            authMethod: "password",
            credentialsSaved: false
          }
        : { type: "socks5", host: transport.host, port: 1080, credentialsSaved: false }
    );
    setDirty(true);
  };

  const isSsh = transport.type === "ssh-tunnel";
  const sshAuthMethod = isSsh ? transport.authMethod : "password";
  const authLabels: Record<string, { secret: string; host: string }> = {
    password: { secret: "Password", host: "Host/IP" },
    "private-key": { secret: "Key passphrase", host: "Host/IP" },
    "ssh-config": { secret: "Key passphrase (if encrypted)", host: "SSH config alias" }
  };
  const labels = authLabels[sshAuthMethod] ?? authLabels.password;

  // Switching between auth modes re-frames what `host` means (IP vs alias),
  // so clear the old value to stop a stray IP becoming a phantom alias.
  const handleAuthChange = (value: string) => {
    if (!isSsh) return;
    const clearingHost = value === "ssh-config" || sshAuthMethod === "ssh-config";
    setTransport(
      clearingHost
        ? { ...transport, authMethod: value, host: "" }
        : { ...transport, authMethod: value }
    );
    setDirty(true);
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
          toast.success("Profile applied.");
        },
        onError: (error) => toast.error(formatAppError(error, "Failed to apply profile."))
      }
    );
  };

  const handleTest = async () => {
    // Test validates the *working copy*: save it first (silently, no toast),
    // then probe. Otherwise the backend tests the last-applied state and the
    // button lies about whatever the user just typed or toggled — the exact
    // trap the old "Profile is disabled" forever-error came from.
    try {
      await saveProfile.mutateAsync({
        id: profile.id,
        name,
        transport,
        enabled,
        secret: secret || undefined
      });
      setSecret("");
      setDirty(false);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to apply profile before testing."));
      return;
    }
    testProfile.mutate(profile.id, {
      onSuccess: (result) => {
        if (result.ok) {
          toast.success(`${result.message} (${result.latencyMs}ms)`);
        } else {
          toast.error(result.message);
        }
      },
      onError: (error) => toast.error(formatAppError(error, "Profile test failed."))
    });
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <Label htmlFor={`profile-name-${profile.id}`} className="text-sm">
          Name
        </Label>
        <Input
          id={`profile-name-${profile.id}`}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setDirty(true);
          }}
          className="max-w-xs"
          aria-label="Profile name"
        />
        <span className="ml-auto text-xs text-muted-foreground">Apply saves the name too.</span>
      </div>
      <Tabs
        value={transport.type}
        onValueChange={(value) => switchKind(value as NetworkTransport["type"])}
        className="flex min-h-0 flex-1 flex-col gap-4 p-4"
      >
        <div className="flex shrink-0 items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="ssh-tunnel">SSH Tunnel</TabsTrigger>
            <TabsTrigger value="socks5">Proxy</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Label htmlFor={`profile-enabled-${profile.id}`} className="text-sm">
              {enabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id={`profile-enabled-${profile.id}`}
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(checked);
                setDirty(true);
              }}
            />
          </div>
        </div>

        <TabsContent value="ssh-tunnel" className="mt-0 space-y-4">
          <p className="text-xs text-muted-foreground">
            Forwards database traffic through an SSH server. The database host/port
            you enter here is the *target* the tunnel opens on the far side.
          </p>
          {sshAuthMethod === "ssh-config" ? (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              Alias mode reads <code>~/.ssh/config</code>: HostName, User, Port,
              IdentityFile and your existing jump chains come from there — the
              fields below are ignored except the alias itself. The passphrase
              field is only used when the config&apos;s key file is encrypted.
            </p>
          ) : null}
          <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-3">
            <Label htmlFor="ssh-host" className="text-right text-sm">{labels.host}</Label>
            <Input
              id="ssh-host"
              value={transport.type === "ssh-tunnel" ? transport.host : ""}
              onChange={(event) => patchTransport({ host: event.target.value })}
              placeholder={sshAuthMethod === "ssh-config" ? "bastion-prod" : "10.xx.xx.50"}
              className="max-w-xs"
            />
            <Label htmlFor="ssh-user" className="text-right text-sm">User Name</Label>
            <Input
              id="ssh-user"
              value={transport.type === "ssh-tunnel" ? transport.username : ""}
              onChange={(event) => patchTransport({ username: event.target.value })}
              disabled={sshAuthMethod === "ssh-config"}
              className="max-w-xs"
            />
            <Label htmlFor="ssh-auth" className="text-right text-sm">Authentication</Label>
            <div>
              <select
                id="ssh-auth"
                value={transport.type === "ssh-tunnel" ? transport.authMethod : "password"}
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
                <Label htmlFor="ssh-key-path" className="text-right text-sm">Key file</Label>
                <Input
                  id="ssh-key-path"
                  value={
                    transport.type === "ssh-tunnel" ? (transport.privateKeyPath ?? "") : ""
                  }
                  onChange={(event) => patchTransport({ privateKeyPath: event.target.value || undefined })}
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
                placeholder={transport.type === "ssh-tunnel" && transport.credentialsSaved ? "••••••••" : ""}
              />
            </div>
            <div />
            <div className="flex items-center gap-2">
              <Checkbox
                id="ssh-save-cred"
                checked={transport.type === "ssh-tunnel" ? transport.credentialsSaved : false}
                onCheckedChange={(checked) => patchTransport({ credentialsSaved: checked === true })}
                disabled
                aria-label="Save credentials"
              />
              <Label htmlFor="ssh-save-cred" className="text-sm font-normal text-muted-foreground">
                Save credentials {transport.type === "ssh-tunnel" && transport.credentialsSaved ? "(saved)" : ""}
              </Label>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="socks5" className="mt-0 space-y-4">
          <p className="text-xs text-muted-foreground">
            Dials database hosts through a SOCKS5 proxy.
          </p>
          <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-3">
            <Label htmlFor="socks-host" className="text-right text-sm">Host</Label>
            <Input
              id="socks-host"
              value={transport.type === "socks5" ? transport.host : ""}
              onChange={(event) => patchSocks({ host: event.target.value })}
              placeholder="127.0.0.1"
              className="max-w-xs"
            />
            <Label htmlFor="socks-port" className="text-right text-sm">Port</Label>
            <Input
              id="socks-port"
              type="number"
              min={1}
              max={65535}
              value={transport.type === "socks5" ? transport.port : 1080}
              onChange={(event) => patchSocks({ port: Number(event.target.value) || 0 })}
              className="max-w-32"
            />
            <Label htmlFor="socks-user" className="text-right text-sm">User name</Label>
            <Input
              id="socks-user"
              value={transport.type === "socks5" ? (transport.username ?? "") : ""}
              onChange={(event) => patchSocks({ username: event.target.value || undefined })}
              className="max-w-xs"
            />
            <Label htmlFor="socks-secret" className="text-right text-sm">Password</Label>
            <div className="flex max-w-xs items-center gap-2">
              <Input
                id="socks-secret"
                type="password"
                value={secret}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setDirty(true);
                }}
                placeholder={transport.type === "socks5" && transport.credentialsSaved ? "••••••••" : ""}
              />
            </div>
            <div />
            <div className="flex items-center gap-2">
              <Checkbox
                id="socks-save-cred"
                checked={transport.type === "socks5" ? transport.credentialsSaved : false}
                onCheckedChange={(checked) => patchSocks({ credentialsSaved: checked === true })}
                disabled
                aria-label="Save password/passphrase"
              />
              <Label htmlFor="socks-save-cred" className="text-sm font-normal text-muted-foreground">
                Save password {transport.type === "socks5" && transport.credentialsSaved ? "(saved)" : ""}
              </Label>
            </div>
          </div>
        </TabsContent>

        <div className="mt-auto flex shrink-0 items-center justify-between gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" size="sm" onClick={handleTest}>
                  {isSsh ? "Test tunnel configuration" : "Test proxy configuration"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Handshake-only; no SQL runs.</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!dirty || saveProfile.isPending} onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
