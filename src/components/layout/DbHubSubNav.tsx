import { Database, Table2 } from "lucide-react";
import { useDbConnections } from "@/hooks/useDbHub";
import { GLUE_TAB, connectionTabValue } from "@/pages/DbHubPage";
import { cn } from "@/lib/utils";

/**
 * The second-level list under the DBHub sidebar item (user request: "DBHub
 * 二级展示 Glue Catalog 和其它 enable 的数据库"): one entry for the Glue
 * workspace plus one per connection pinned with Show-as-tab, so the user can
 * jump straight to a database's query page without landing on the Overview
 * first. Renders only while DBHub is the active page; the parent keeps it
 * mounted to avoid refetch churn on every page switch.
 */
export function DbHubSubNav({
  activeSubTab,
  onSelect,
  collapsed
}: {
  /** The DbHubPage tab value currently shown; undefined when DBHub is inactive. */
  activeSubTab?: string;
  onSelect: (tabValue: string) => void;
  collapsed: boolean;
}) {
  const connectionsQuery = useDbConnections();
  const connections = (connectionsQuery.data ?? []).filter(
    (connection) => connection.showAsTab
  );

  if (collapsed) return null;

  const entries = [
    { value: GLUE_TAB, label: "Glue Catalog", icon: Table2 },
    ...connections.map((connection) => ({
      value: connectionTabValue(connection.id),
      label: connection.name,
      icon: Database
    }))
  ];

  return (
    <div className="ml-8 space-y-0.5 border-l pl-2" role="list" aria-label="DBHub data sources">
      {entries.map((entry) => {
        const Icon = entry.icon;
        const active = entry.value === activeSubTab;
        return (
          <button
            key={entry.value}
            type="button"
            role="listitem"
            onClick={() => onSelect(entry.value)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="size-3 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{entry.label}</span>
          </button>
        );
      })}
    </div>
  );
}
