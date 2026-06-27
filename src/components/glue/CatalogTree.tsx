import { ArrowLeft, Database, PanelLeftClose, RefreshCw, Search, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useGlueDatabases, useGlueTables } from "@/hooks/useGlue";

export function CatalogTree({
  viewDatabase,
  selectedDatabase,
  selectedTable,
  onFocusDatabase,
  onExitDatabase,
  onSelectTable,
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
      <div className="flex items-center gap-1.5">
        {activeDatabase ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7"
            aria-label="Back to databases"
            onClick={exitDatabase}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={activeDatabase ? "Filter tables" : "Filter databases"}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          onClick={onRefresh}
          aria-label="Refresh catalog"
        >
          <RefreshCw className={cn("size-3.5", databases.isFetching && "animate-spin")} />
        </Button>
        {onCollapse ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-7"
                aria-label="Collapse catalog panel"
                onClick={onCollapse}
              >
                <PanelLeftClose className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Hide catalog{collapseShortcut ? ` · ${collapseShortcut}` : ""}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

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
          />
        ) : (
          <DatabaseListView
            databases={filteredDatabases}
            loading={databases.isLoading}
            error={databases.error}
            onEnterDatabase={enterDatabase}
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
  onEnterDatabase
}: {
  databases: Array<{ name: string }>;
  loading: boolean;
  error: unknown;
  onEnterDatabase: (name: string) => void;
}) {
  if (loading) return <p className="p-2 text-xs text-muted-foreground">Loading databases...</p>;
  if (error) return <p className="p-2 text-xs text-destructive">Failed to load databases.</p>;
  if (databases.length === 0) return <p className="p-2 text-xs text-muted-foreground">No databases found.</p>;

  return (
    <ul className="divide-y">
      {databases.map((database) => (
        <li key={database.name}>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => onEnterDatabase(database.name)}
          >
            <Database className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{database.name}</span>
          </button>
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
  onSelectTable
}: {
  databaseName: string;
  tables: Array<{ name: string }>;
  loading: boolean;
  error: unknown;
  selectedDatabase?: string;
  selectedTable?: string;
  onSelectTable: (databaseName: string, tableName: string) => void;
}) {
  return (
    <div>
      <div className="border-b bg-muted/30 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
        <Database className="mr-1 inline size-3" />
        {databaseName}
      </div>
      {loading ? <p className="p-2 text-xs text-muted-foreground">Loading tables...</p> : null}
      {error ? <p className="p-2 text-xs text-destructive">Failed to load tables.</p> : null}
      {!loading && tables.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No tables in this database.</p>
      ) : null}
      <ul className="divide-y">
        {tables.map((table) => {
          const active = selectedDatabase === databaseName && selectedTable === table.name;
          return (
            <li key={table.name}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs hover:bg-accent",
                  active && "bg-primary/10 text-primary"
                )}
                onClick={() => onSelectTable(databaseName, table.name)}
              >
                <Table2 className="size-3.5 shrink-0" />
                <span className="truncate">{table.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
