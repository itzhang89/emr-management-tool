import { useState } from "react";
import { FileText, Plus, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDeleteNetworkProfile,
  useNetworkProfiles,
  useSaveNetworkProfile
} from "@/hooks/useDbHub";
import { formatAppError } from "@/services/appErrorMessage";
import type { NetworkProfile, NetworkProfileInput, NetworkTransport } from "@/types/domain";
import { ProfileDetail } from "./ProfileDetail";

/**
 * Network Profiles, rendered inside the DBHub Overview (design section 6):
 * a Master–Detail pair — profile list on the left with Create/Delete/Copy on
 * its bottom edge, the selected profile's SSH Tunnel | Proxy form on the
 * right, and a shared Apply footer. Fields follow the DBeaver-style mock the
 * design was built from.
 */
export function NetworkProfilesSection() {
  const profilesQuery = useNetworkProfiles();
  const profiles = profilesQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0];

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Network Profiles</h3>
        <p className="text-xs text-muted-foreground">
          SSH tunnels and SOCKS5 proxies for the active AWS account.
        </p>
      </div>
      <div className="grid min-h-[24rem] grid-cols-1 divide-y md:grid-cols-[16rem_1fr] md:divide-x md:divide-y-0">
        <ProfileList
          profiles={profiles}
          selectedId={selected?.id}
          loading={profilesQuery.isLoading}
          onSelect={setSelectedId}
        />
        <div className="min-w-0">
          {selected ? (
            <ProfileDetail key={selected.id} profile={selected} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Create a profile to route database connections through SSH tunnels
              or SOCKS5 proxies.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileList({
  profiles,
  selectedId,
  loading,
  onSelect
}: {
  profiles: NetworkProfile[];
  selectedId?: string;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const createProfile = useSaveNetworkProfile();
  const deleteProfile = useDeleteNetworkProfile();

  const handleCreate = () => {
    const input: NetworkProfileInput = {
      name: nextProfileName(profiles),
      transport: {
        type: "ssh-tunnel",
        host: "",
        port: 22,
        username: "root",
        authMethod: "password",
        credentialsSaved: false
      },
      enabled: false
    };
    createProfile.mutate(input, {
      onSuccess: (profile) => {
        onSelect(profile.id);
        toast.success(`Profile "${profile.name}" created.`);
      },
      onError: (error) => toast.error(formatAppError(error, "Failed to create profile."))
    });
  };

  const handleCopy = () => {
    const source = profiles.find((profile) => profile.id === selectedId);
    if (!source) return;
    const input: NetworkProfileInput = {
      name: `${source.name} copy`,
      transport: source.transport,
      enabled: false
    };
    createProfile.mutate(input, {
      onSuccess: (profile) => {
        onSelect(profile.id);
        toast.success(`Profile copied as "${profile.name}".`);
      },
      onError: (error) => toast.error(formatAppError(error, "Failed to copy profile."))
    });
  };

  const handleDelete = () => {
    if (!selectedId) return;
    deleteProfile.mutate(selectedId, {
      onSuccess: () => toast.success("Profile deleted. Connections fell back to direct."),
      onError: (error) => toast.error(formatAppError(error, "Failed to delete profile."))
    });
  };

  return (
    <div className="flex min-h-0 flex-col">
      <ul className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Network profiles">
        {loading ? <li className="p-2 text-sm text-muted-foreground">Loading…</li> : null}
        {profiles.map((profile) => (
          <li key={profile.id}>
            <button
              type="button"
              onClick={() => onSelect(profile.id)}
              aria-current={profile.id === selectedId}
              className={
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm " +
                (profile.id === selectedId
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-secondary/60")
              }
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">{profile.name}</span>
              {!profile.enabled ? (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">off</span>
              ) : null}
            </button>
          </li>
        ))}
        {!loading && profiles.length === 0 ? (
          <li className="p-2 text-sm text-muted-foreground">No profiles yet.</li>
        ) : null}
      </ul>
      <div className="flex items-center gap-1 border-t p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Create profile"
              disabled={createProfile.isPending}
              onClick={handleCreate}
            >
              <Plus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Delete profile"
              disabled={!selectedId || deleteProfile.isPending}
              onClick={handleDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Copy profile"
              disabled={!selectedId || createProfile.isPending}
              onClick={handleCopy}
            >
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function nextProfileName(profiles: NetworkProfile[]) {
  const base = "New profile";
  if (!profiles.some((profile) => profile.name === base)) return base;
  let index = 2;
  while (profiles.some((profile) => profile.name === `${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function transportDefaults(kind: NetworkTransport["type"]): NetworkTransport {
  return kind === "ssh-tunnel"
    ? { type: "ssh-tunnel", host: "", port: 22, username: "root", authMethod: "password", credentialsSaved: false }
    : { type: "socks5", host: "127.0.0.1", port: 1080, credentialsSaved: false };
}
