import { useState } from "react";
import { Network } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useDbConnections, useDeleteDbConnection, useNetworkProfiles } from "@/hooks/useDbHub";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useT } from "@/i18n";
import { clearDbWorkspace } from "@/services/dbWorkspaceCache";
import { formatAppError } from "@/services/appErrorMessage";
import type { DbConnection } from "@/types/domain";
import { ConnectionCard } from "./ConnectionCard";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { NetworkProfilesSection } from "./NetworkProfilesSection";

/**
 * The DBHub Overview tab (design section 1, as adjusted): connection cards for
 * the active AWS account, with a single toolbar icon opening the Network
 * Profiles manager in a dialog — the board is an entry, not a fixture of the
 * page. Add Connection / the card edit pencil open the DBeaver-style wizard.
 */
export function OverviewPanel() {
  const t = useT();
  const connectionsQuery = useDbConnections();
  const profilesQuery = useNetworkProfiles();
  const deleteConnection = useDeleteDbConnection();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const connections = connectionsQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<DbConnection>();
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DbConnection>();

  const openCreate = () => {
    setEditing(undefined);
    setWizardOpen(true);
  };
  const openEdit = (connection: DbConnection) => {
    setEditing(connection);
    setWizardOpen(true);
  };
  const openDelete = (connection: DbConnection) => {
    setEditing(undefined);
    setPendingDelete(connection);
  };
  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteConnection.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t('Connection "{name}" deleted.', { name: pendingDelete.name }));
        // Its dynamic tab is gone; drop the cached workspace so a stale draft
        // never reappears if the user later recreates the connection.
        if (accountId) clearDbWorkspace(accountId, pendingDelete.id);
        setPendingDelete(undefined);
      },
      onError: (error) => toast.error(formatAppError(error, "Failed to delete connection."))
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <section aria-label={t("Database connections")} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{t("Database connections")}</h2>
            <p className="text-sm text-muted-foreground">
              {connections.length === 0
                ? t("No connections for this AWS account yet.")
                : t("{count} connection(s), pinned to tabs: {pinned}", {
                    count: connections.length,
                    pinned: connections.filter((connection) => connection.showAsTab).length
                  })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("Manage Network Profiles")}
                  onClick={() => setProfilesOpen(true)}
                >
                  <Network className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("Network Profiles ({count}) — SSH tunnels & SOCKS5 proxies", {
                  count: profiles.length
                })}
              </TooltipContent>
            </Tooltip>
            <Button type="button" size="sm" onClick={openCreate}>
              {t("Add Connection")}
            </Button>
          </div>
        </div>
        {connectionsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Loading connections…")}</p>
        ) : null}
        {connectionsQuery.error ? (
          <p className="text-sm text-destructive">Failed to load connections.</p>
        ) : null}
        {connections.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                profiles={profiles}
                onEdit={openEdit}
                onDelete={openDelete}
              />
            ))}
          </div>
        ) : null}
      </section>

      <Dialog open={profilesOpen} onOpenChange={setProfilesOpen}>
        {/* Same clamp as the connection form: the board is tall enough to run
            off a laptop screen, and it must not touch the window edges. */}
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Network Profiles")}</DialogTitle>
            <DialogDescription>
              {t("SSH tunnels and SOCKS5 proxies this account's connections can dial through.")}
            </DialogDescription>
          </DialogHeader>
          <NetworkProfilesSection />
        </DialogContent>
      </Dialog>

      <ConnectionFormDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        connection={editing}
      />

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Delete connection?")}</DialogTitle>
            <DialogDescription>
              {t('Delete "{name}"?', { name: pendingDelete?.name ?? "" })}{" "}
              {t(
                "This removes the saved connection and its passwords, hides its query tab, and drops its cached workspace. Read-only AI queries to it are disabled too. This cannot be undone."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(undefined)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteConnection.isPending}
              onClick={confirmDelete}
            >
              {t("Delete connection")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
