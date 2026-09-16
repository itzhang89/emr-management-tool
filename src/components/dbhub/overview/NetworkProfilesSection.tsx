import { useRef, useState } from "react";
import { FileText, Plus, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  useDbConnections,
  useDeleteNetworkProfile,
  useNetworkProfiles,
  useSaveNetworkProfile
} from "@/hooks/useDbHub";
import { formatAppError } from "@/services/appErrorMessage";
import type { NetworkProfile, NetworkProfileInput } from "@/types/domain";
import { ProfileDetail } from "./ProfileDetail";
import { defaultSshTransport, transportLabel } from "./transports";

/**
 * Network Profiles, rendered inside the DBHub Overview (design section 6):
 * a Master–Detail pair — profile list on the left with Create/Delete/Copy on
 * its bottom edge, the selected profile's SSH Tunnel | Proxy form on the
 * right, and a shared Apply footer. Fields follow the DBeaver-style mock the
 * design was built from.
 *
 * Deleting a profile that is still bound to a connection is refused: the
 * Delete button prompts with which connections use it, asking the user to
 * unbind those first (a silent delete would leave them suddenly direct).
 */
export function NetworkProfilesSection() {
  const profilesQuery = useNetworkProfiles();
  const connectionsQuery = useDbConnections();
  const profiles = profilesQuery.data ?? [];
  const connections = connectionsQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0];

  // Delete is confirmed through one of two dialogs, decided by whether the
  // profile is still bound.
  const [deleteTarget, setDeleteTarget] = useState<NetworkProfile>();
  const referencing = deleteTarget
    ? connections.filter((connection) => connection.networkProfileId === deleteTarget.id)
    : [];
  const deleteRefuses = Boolean(deleteTarget && referencing.length > 0);
  const deleteRefusesOpen = deleteRefuses;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Network Profiles</h3>
        <p className="text-xs text-muted-foreground">
          SSH tunnels and SOCKS5 proxies for the active AWS account. Double-click a
          name to rename it.
        </p>
      </div>
      <div className="grid min-h-[24rem] grid-cols-1 divide-y md:grid-cols-[16rem_1fr] md:divide-x md:divide-y-0">
        <ProfileList
          profiles={profiles}
          selectedId={selected?.id}
          loading={profilesQuery.isLoading}
          onSelect={setSelectedId}
          onRequestDelete={setDeleteTarget}
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

      {/* Bound → refuse with the referencing connections listed. */}
      <Dialog open={deleteRefusesOpen} onOpenChange={(open) => !open && setDeleteTarget(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Profile is in use</DialogTitle>
            <DialogDescription>
              "{deleteTarget?.name}" is still bound to {referencing.length} connection
              {referencing.length === 1 ? "" : "s"}. Remove the Network Profile from those
              connections before deleting it, or they will keep pointing at a tunnel that no
              longer exists.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
            {referencing.map((connection) => (
              <li key={connection.id} className="flex items-center gap-2">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{connection.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{connection.kind}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(undefined)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unbound → confirm, then delete. */}
      <ConfirmDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(undefined)} />
    </div>
  );
}

function ConfirmDeleteDialog({
  target,
  onClose
}: {
  target?: NetworkProfile;
  onClose: () => void;
}) {
  const deleteProfile = useDeleteNetworkProfile();
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete profile?</DialogTitle>
          <DialogDescription>
            Delete "{target?.name}"? Connections already route directly; this only removes
            the profile so it can no longer be chosen.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteProfile.isPending}
            onClick={() => {
              if (!target) return;
              deleteProfile.mutate(target.id, {
                onSuccess: () => {
                  onClose();
                  toast.success(`Profile "${target.name}" deleted.`);
                },
                onError: (error) => toast.error(formatAppError(error, "Failed to delete profile."))
              });
            }}
          >
            Delete profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileList({
  profiles,
  selectedId,
  loading,
  onSelect,
  onRequestDelete
}: {
  profiles: NetworkProfile[];
  selectedId?: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onRequestDelete: (profile: NetworkProfile) => void;
}) {
  const saveProfile = useSaveNetworkProfile();

  const handleCreate = () => {
    const input: NetworkProfileInput = {
      name: nextProfileName(profiles),
      transport: defaultSshTransport(),
      // Enabled from birth: a brand-new profile is the user's active intent,
      // and the previous `false` default made every test click answer
      // "disabled" until Apply was found and pressed.
      enabled: true
    };
    saveProfile.mutate(input, {
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
      // A copy starts enabled too — the user duplicates a working profile to
      // tweak it, not to have it inert.
      enabled: true
    };
    saveProfile.mutate(input, {
      onSuccess: (profile) => {
        onSelect(profile.id);
        toast.success(`Profile copied as "${profile.name}".`);
      },
      onError: (error) => toast.error(formatAppError(error, "Failed to copy profile."))
    });
  };

  const handleDelete = () => {
    if (!selectedId) return;
    const profile = profiles.find((entry) => entry.id === selectedId);
    if (profile) onRequestDelete(profile);
  };

  // --- Rename in place -------------------------------------------------------
  // Double-clicking a name turns that row into an input; Enter or clicking
  // away commits, Escape abandons. It is its own save rather than a mark of
  // the detail form's dirty state, so a rename is never lost by forgetting to
  // press Apply.
  const [renamingId, setRenamingId] = useState<string>();
  const [draftName, setDraftName] = useState("");
  // Enter unmounts the input, which can still deliver a blur on the way out.
  // This keeps the rename from being sent twice.
  const renameSettled = useRef(false);

  const startRename = (profile: NetworkProfile) => {
    onSelect(profile.id);
    setDraftName(profile.name);
    setRenamingId(profile.id);
    renameSettled.current = false;
  };

  const finishRename = (profile: NetworkProfile, commit: boolean) => {
    if (renamingId !== profile.id || renameSettled.current) return;
    renameSettled.current = true;
    setRenamingId(undefined);

    const name = draftName.trim();
    if (!commit || !name || name === profile.name) return;

    saveProfile.mutate(
      // The command upserts the whole profile, and `enabled` defaults to false
      // when it is left out — so a rename has to send the stored profile back
      // intact, or it would quietly disable the thing it renamed.
      { id: profile.id, name, transport: profile.transport, enabled: profile.enabled },
      {
        onSuccess: () => toast.success("Profile renamed."),
        onError: (error) => toast.error(formatAppError(error, "Failed to rename profile."))
      }
    );
  };

  return (
    <div className="flex min-h-0 flex-col">
      <ul className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Network profiles">
        {loading ? <li className="p-2 text-sm text-muted-foreground">Loading…</li> : null}
        {profiles.map((profile) => {
          const selected = profile.id === selectedId;
          const rowClass =
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm " +
            (selected ? "bg-accent text-accent-foreground" : "hover:bg-secondary/60");

          return (
            <li key={profile.id}>
              {profile.id === renamingId ? (
                <div className={rowClass}>
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <Input
                    autoFocus
                    value={draftName}
                    aria-label="Profile name"
                    className="h-7 min-w-0 flex-1 text-sm"
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") finishRename(profile, true);
                      if (event.key === "Escape") finishRename(profile, false);
                    }}
                    onBlur={() => finishRename(profile, true)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(profile.id)}
                  onDoubleClick={() => startRename(profile)}
                  aria-current={selected}
                  className={rowClass}
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate">{profile.name}</span>
                  <TransportTag name={transportLabel(profile.transport)} />
                </button>
              )}
            </li>
          );
        })}
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
              disabled={saveProfile.isPending}
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
              disabled={!selectedId}
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
              disabled={!selectedId || saveProfile.isPending}
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

/**
 * Which transport a profile carries. SSH Tunnel and Proxy are a choice, so
 * the list is where you see which one each profile made. A span, not a Badge:
 * this sits inside the row's button, which only accepts phrasing content.
 */
function TransportTag({ name }: { name: string }) {
  return (
    <span className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
      {name}
    </span>
  );
}
