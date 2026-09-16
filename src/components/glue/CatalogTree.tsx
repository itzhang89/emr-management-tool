import { Database, Info, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CatalogRow } from "@/components/catalog/CatalogRow";
import { CatalogToolbar } from "@/components/catalog/CatalogToolbar";
import { useGlueDatabases, useGlueTables } from "@/hooks/useGlue";

/**
 * The Glue catalog tree: two levels (databases, then a database's tables),
 * built from the shared catalogue chrome — [`CatalogToolbar`] and
 * [`CatalogRow`] — with Glue's own data hooks and metadata buttons.
 *
 * What is Glue's alone stays here: which hook supplies each level, and the
 * "you are inside X" band with its own details button.
 */
export function CatalogTree({
  viewDatabase,
  selectedDatabase,
  selectedTable,
  onFocusDatabase,
  onExitDatabase,
  onSelectTable,
  onShowDatabaseMetadata,
  onShowTableMetadata,
  onRefresh,
  onCollapse,
  collapseShortcut
}: {
  viewDatabase?: string;
  selectedDatabase?: string;
  selectedTable?: string;
  onFocusDatabase: (databaseName: string) => void;
  onExitDatabase: () => void;
  onSelectTable: (databaseName: string, tableName: string) => void;
  onShowDatabaseMetadata: (databaseName: string) => void;
  onShowTableMetadata: (databaseName: string, tableName: string) => void;
  onRefresh: () => void;
  onCollapse?: () => void;
  collapseShortcut?: string;
}) {
  const databases = useGlueDatabases();
  const [filter, setFilter] = useState("");

  const activeDatabase = viewDatabase;
  const tables = useGlueTables(activeDatabase);

  const filteredDatabases = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = databases.data ?? [];
    if (!needle) return list;
    return list.filter((database) => database.name.toLowerCase().includes(needle));
  }, [databases.data, filter]);

  const filteredTables = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = tables.data ?? [];
    if (!needle) return list;
    return list.filter((table) => table.name.toLowerCase().includes(needle));
  }, [tables.data, filter]);

  const enterDatabase = (databaseName: string) => {
    setFilter("");
    onFocusDatabase(databaseName);
  };

  const exitDatabase = () => {
    setFilter("");
    onExitDatabase();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <CatalogToolbar
        backLabel={activeDatabase ? "Back to databases" : undefined}
        onBack={exitDatabase}
        filter={filter}
        onFilterChange={setFilter}
        filterPlaceholder={activeDatabase ? "Filter tables" : "Filter databases"}
        onRefresh={onRefresh}
        refreshing={databases.isFetching}
        onCollapse={onCollapse}
        collapseShortcut={collapseShortcut}
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-md border text-xs">
        {activeDatabase ? (
          <DatabaseTablesView
            databaseName={activeDatabase}
            tables={filteredTables}
            loading={tables.isLoading}
            error={tables.error}
            selectedDatabase={selectedDatabase}
            selectedTable={selectedTable}
            onSelectTable={onSelectTable}
            onShowDatabaseMetadata={onShowDatabaseMetadata}
            onShowTableMetadata={onShowTableMetadata}
          />
        ) : (
          <DatabaseListView
            databases={filteredDatabases}
            loading={databases.isLoading}
            error={databases.error}
            onEnterDatabase={enterDatabase}
            onShowDatabaseMetadata={onShowDatabaseMetadata}
          />
        )}
      </div>
    </div>
  );
}

function DatabaseListView({
  databases,
  loading,
  error,
  onEnterDatabase,
  onShowDatabaseMetadata
}: {
  databases: Array<{ name: string }>;
  loading: boolean;
  error: unknown;
  onEnterDatabase: (name: string) => void;
  onShowDatabaseMetadata: (name: string) => void;
}) {
  if (loading) return <p className="p-2 text-xs text-muted-foreground">Loading databases...</p>;
  if (error) return <p className="p-2 text-xs text-destructive">Failed to load databases.</p>;
  if (databases.length === 0) return <p className="p-2 text-xs text-muted-foreground">No databases found.</p>;

  return (
    <ul className="divide-y">
      {databases.map((database) => (
        <li key={database.name}>
          <CatalogRow
            name={database.name}
            emphasis
            icon={<Database className="size-3.5 shrink-0 text-muted-foreground" />}
            onSelect={() => onEnterDatabase(database.name)}
            infoLabel={`Show details for ${database.name}`}
            infoTooltip="Database details"
            onShowInfo={() => onShowDatabaseMetadata(database.name)}
          />
        </li>
      ))}
    </ul>
  );
}

function DatabaseTablesView({
  databaseName,
  tables,
  loading,
  error,
  selectedDatabase,
  selectedTable,
  onSelectTable,
  onShowDatabaseMetadata,
  onShowTableMetadata
}: {
  databaseName: string;
  tables: Array<{ name: string }>;
  loading: boolean;
  error: unknown;
  selectedDatabase?: string;
  selectedTable?: string;
  onSelectTable: (databaseName: string, tableName: string) => void;
  onShowDatabaseMetadata: (databaseName: string) => void;
  onShowTableMetadata: (databaseName: string, tableName: string) => void;
}) {
  return (
    <div>
      {/* Which database these tables belong to, and its own details button —
          the one piece of the drill-down that has no analogue elsewhere. */}
      <div className="group flex items-center gap-1 border-b bg-muted/30 px-1.5 py-1 text-[11px] font-medium text-muted-foreground">
        <div className="min-w-0 flex-1 truncate px-1">
          <Database className="mr-1 inline size-3" />
          {databaseName}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Show details for ${databaseName}`}
              onClick={() => onShowDatabaseMetadata(databaseName)}
            >
              <Info className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Database details</TooltipContent>
        </Tooltip>
      </div>
      {loading ? <p className="p-2 text-xs text-muted-foreground">Loading tables...</p> : null}
      {error ? <p className="p-2 text-xs text-destructive">Failed to load tables.</p> : null}
      {!loading && tables.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No tables in this database.</p>
      ) : null}
      <ul className="divide-y">
        {tables.map((table) => (
          <li key={table.name}>
            <CatalogRow
              name={table.name}
              selected={selectedDatabase === databaseName && selectedTable === table.name}
              icon={<Table2 className="size-3.5 shrink-0" />}
              onSelect={() => onSelectTable(databaseName, table.name)}
              infoLabel={`Show details for ${table.name}`}
              infoTooltip="Table details"
              onShowInfo={() => onShowTableMetadata(databaseName, table.name)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
