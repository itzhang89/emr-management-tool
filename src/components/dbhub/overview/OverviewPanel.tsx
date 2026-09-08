import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDbConnections, useNetworkProfiles } from "@/hooks/useDbHub";
import type { DbConnection } from "@/types/domain";
import { ConnectionCard } from "./ConnectionCard";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { NetworkProfilesSection } from "./NetworkProfilesSection";

/**
 * The DBHub Overview tab (design section 1): the management hub for the active
 * AWS account. Connection cards (with the Show-as-tab / Enabled-for-AI
 * switches) sit on top; the Network Profiles Master–Detail board sits below.
 * Add Connection / the card edit pencil open the DBeaver-style wizard.
 */
export function OverviewPanel() {
  const connectionsQuery = useDbConnections();
  const profilesQuery = useNetworkProfiles();
  const connections = connectionsQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<DbConnection>();

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
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus data-icon="inline-start" />
            Add Connection
          </Button>
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

      <NetworkProfilesSection />

      <ConnectionFormDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        connection={editing}
      />
    </div>
  );
}
