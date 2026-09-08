import { useState } from "react";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDbConnections, useNetworkProfiles } from "@/hooks/useDbHub";
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
  const connectionsQuery = useDbConnections();
  const profilesQuery = useNetworkProfiles();
  const connections = connectionsQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<DbConnection>();
  const [profilesOpen, setProfilesOpen] = useState(false);

  const openCreate = () => {
    setEditing(undefined);
    setWizardOpen(true);
  };
  const openEdit = (connection: DbConnection) => {
    setEditing(connection);
    setWizardOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <section aria-label="Database connections" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Database connections</h2>
            <p className="text-sm text-muted-foreground">
              {connections.length === 0
                ? "No connections for this AWS account yet."
                : `${connections.length} connection(s), pinned to tabs: ${connections.filter((connection) => connection.showAsTab).length}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Manage Network Profiles"
                  onClick={() => setProfilesOpen(true)}
                >
                  <Network className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Network Profiles ({profiles.length}) — SSH tunnels &amp; SOCKS5 proxies
              </TooltipContent>
            </Tooltip>
            <Button type="button" size="sm" onClick={openCreate}>
              Add Connection
            </Button>
          </div>
        </div>
        {connectionsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading connections…</p>
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
              />
            ))}
          </div>
        ) : null}
      </section>

      <Dialog open={profilesOpen} onOpenChange={setProfilesOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Network Profiles</DialogTitle>
            <DialogDescription>
              SSH tunnels and SOCKS5 proxies this account's connections can dial through.
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
    </div>
  );
}
