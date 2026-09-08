import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { GlueCatalogTab } from "@/components/dbhub/workspace/GlueCatalogTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useDbConnections } from "@/hooks/useDbHub";

/**
 * DBHub — the hub for every queryable data source (Glue/Athena today, JDBC
 * connections like MySQL/PostgreSQL/Yellowbrick later).
 *
 * Two fixed tabs: Overview (connection management — cards, network profiles,
 * the add-connection wizard) and Glue Catalog (the Athena workspace, moved
 * here verbatim from the old GlueCatalogPage). Connections marked showAsTab
 * additionally appear as their own query tabs (the workspace lands in batch 4).
 *
 * Workspace tabs mount lazily on first activation and then never unmount on
 * tab switch, so the SQL editor, result tabs and catalog selection survive
 * moving between tabs. Radix `forceMount` keeps every TabsContent in the DOM;
 * PersistMount gates the expensive child on "has been active at least once",
 * which gives lazy mounting without losing state afterwards.
 */

type TabConnection = {
  id: string;
  name: string;
  kind: string;
  showAsTab: boolean;
};

const OVERVIEW_TAB = "overview";
const GLUE_TAB = "glue";

function connectionTabValue(connectionId: string) {
  return `connection:${connectionId}`;
}

export function DbHubPage() {
  const connectionsQuery = useDbConnections();
  const connections: TabConnection[] = connectionsQuery.data ?? [];
  const [activeTab, setActiveTab] = useState(OVERVIEW_TAB);

  const dynamicTabs = connections.filter((connection) => connection.showAsTab);

  return (
    // Pinned to the viewport the same way Logs and AI Assistant are (3rem is
    // the main element's padding): every tab scrolls inside itself, so the
    // page must not grow and hand its overflow to the window.
    <div className="flex h-[calc(100vh-3rem)] min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
      >
        <TabsList className="w-fit max-w-full overflow-x-auto">
          <TabsTrigger value={OVERVIEW_TAB}>Overview</TabsTrigger>
          <TabsTrigger value={GLUE_TAB}>Glue Catalog</TabsTrigger>
          {dynamicTabs.map((connection) => (
            <TabsTrigger key={connection.id} value={connectionTabValue(connection.id)}>
              <Database className="mr-1.5 size-3.5 shrink-0" aria-hidden />
              {connection.name}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value={OVERVIEW_TAB}
          className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          <OverviewPlaceholder connectionCount={connections.length} />
        </TabsContent>

        <TabsContent
          value={GLUE_TAB}
          forceMount
          className="mt-0 hidden min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex"
        >
          <PersistMount visible={activeTab === GLUE_TAB} className="flex min-h-0 w-full flex-col">
            <GlueCatalogTab />
          </PersistMount>
        </TabsContent>

        {dynamicTabs.map((connection) => {
          const value = connectionTabValue(connection.id);
          return (
            <TabsContent
              key={connection.id}
              value={value}
              forceMount
              className="mt-0 hidden min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex"
            >
              <PersistMount
                visible={activeTab === value}
                className="flex min-h-0 w-full flex-col"
              >
                <ConnectionTabPlaceholder connection={connection} />
              </PersistMount>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

/**
 * Flips `mounted` to true the first time `visible` is true and never flips
 * back, so children mount lazily (no Glue/Athena work until the tab is first
 * opened) and then keep their React state — editor text, result tabs, tree
 * selection — across tab switches. The wrapper is also the layout box the
 * workspace fills: `hidden` on an inactive TabsContent needs the child to
 * re-apply flex when the panel becomes active again.
 */
function PersistMount({
  visible,
  className,
  children
}: {
  visible: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
  }, [visible]);

  if (!mounted) return null;
  return <div className={className}>{children}</div>;
}

function OverviewPlaceholder({ connectionCount }: { connectionCount: number }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md space-y-3 text-center">
        <h2 className="text-lg font-semibold">DBHub Overview</h2>
        <p className="text-sm text-muted-foreground">
          Manage database connections and network profiles for the active AWS account.
          {connectionCount > 0 ? ` ${connectionCount} connection(s) registered.` : ""}
        </p>
        <div className="flex justify-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled>
            Add Connection
          </Button>
          <Button type="button" variant="outline" size="sm" disabled>
            Network Profiles
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Coming in the next DBHub batch.</p>
      </div>
    </div>
  );
}

function ConnectionTabPlaceholder({ connection }: { connection: TabConnection }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md space-y-3 text-center">
        <h2 className="text-lg font-semibold">{connection.name}</h2>
        <p className="text-sm capitalize text-muted-foreground">{connection.kind} query workspace</p>
        <p className="text-xs text-muted-foreground">
          The JDBC query workspace lands in DBHub batch 4; the connection stays registered
          for AI in the meantime.
        </p>
      </div>
    </div>
  );
}
