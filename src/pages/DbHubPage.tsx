import { useEffect, useState } from "react";
import { GlueCatalogTab } from "@/components/dbhub/workspace/GlueCatalogTab";
import { ConnectionQueryTab } from "@/components/dbhub/workspace/ConnectionQueryTab";
import { OverviewPanel } from "@/components/dbhub/overview/OverviewPanel";
import { DbKindIcon } from "@/components/dbhub/DbKindIcon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDbConnections } from "@/hooks/useDbHub";
import { useT } from "@/i18n";

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

/**
 * Widens a persisted connection into the shape the tab bar needs. The full
 * DbConnection flows into ConnectionQueryTab through the same list — the tab
 * content below maps back into it by id.
 */
export const OVERVIEW_TAB = "overview";
export const GLUE_TAB = "glue";

export function connectionTabValue(connectionId: string) {
  return `connection:${connectionId}`;
}

export function DbHubPage({
  initialTab,
  onOpenAiAssistant
}: {
  /** Tab value to land on at mount (sidebar sub-navigation). One-shot: user
   * clicks inside the page take over afterwards. */
  initialTab?: string;
  /** Jump to the AI Assistant Chat tab after queuing a DB analysis intent. */
  onOpenAiAssistant?: () => void;
}) {
  const t = useT();
  const connectionsQuery = useDbConnections();
  const connections = connectionsQuery.data ?? [];
  const [activeTab, setActiveTab] = useState(initialTab ?? OVERVIEW_TAB);

  // When the page re-mounts with a different landing intent (e.g. the sidebar
  // switched from Overview to a connection), follow it.
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const dynamicTabs = connections.filter((connection) => connection.showAsTab);

  return (
    // `h-full`, not `calc(100vh-3rem)`: the shell pins itself to the viewport
    // and `main` is the only thing between them, so the page now measures
    // whatever `main` actually has instead of re-deriving it from the window
    // (which silently went stale as soon as anything else changed the shell's
    // height). Every tab then scrolls inside itself and the page never hands
    // its overflow to the window.
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
      >
        <TabsList className="w-fit max-w-full overflow-x-auto">
          <TabsTrigger value={OVERVIEW_TAB}>{t("Overview")}</TabsTrigger>
          <TabsTrigger value={GLUE_TAB}>{t("Glue Catalog")}</TabsTrigger>
          {dynamicTabs.map((connection) => (
            <TabsTrigger key={connection.id} value={connectionTabValue(connection.id)}>
              <DbKindIcon kind={connection.kind} className="mr-1.5 size-3.5" />
              {connection.name}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value={OVERVIEW_TAB}
          className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          <OverviewPanel />
        </TabsContent>

        <TabsContent
          value={GLUE_TAB}
          forceMount
          className="mt-0 hidden min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex"
        >
          <PersistMount visible={activeTab === GLUE_TAB} className="flex min-h-0 w-full flex-col">
            <GlueCatalogTab active={activeTab === GLUE_TAB} />
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
                <ConnectionQueryTab
                  connection={connection}
                  active={activeTab === value}
                  onOpenAiAssistant={onOpenAiAssistant}
                />
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

