import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDbConnections, useNetworkProfiles } from "@/hooks/useDbHub";
import { ConnectionCard } from "./ConnectionCard";
import { NetworkProfilesSection } from "./NetworkProfilesSection";

/**
 * The DBHub Overview tab (design section 1): the management hub for the active
 * AWS account. Connection cards (with the Show-as-tab / Enabled-for-AI
 * switches) sit on top; the Network Profiles Master–Detail board sits below.
 * The add-connection wizard replaces the disabled button in batch 3.
 */
export function OverviewPanel() {
  const connectionsQuery = useDbConnections();
  const profilesQuery = useNetworkProfiles();
  const connections = connectionsQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];

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
          <Button type="button" size="sm" disabled>
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
              <ConnectionCard key={connection.id} connection={connection} profiles={profiles} />
            ))}
          </div>
        ) : null}
      </section>

      <NetworkProfilesSection />
    </div>
  );
}
