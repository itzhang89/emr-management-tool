import { ChevronDown, ChevronRight, Database, RefreshCw, Search, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useGlueDatabases, useGlueTables } from "@/hooks/useGlue";
import type { GlueDatabase } from "@/types/domain";

export function CatalogTree({
  selectedDatabase,
  selectedTable,
  onSelectTable,
  onRefresh
}: {
  selectedDatabase?: string;
  selectedTable?: string;
  onSelectTable: (databaseName: string, tableName: string) => void;
  onRefresh: () => void;
}) {
  const databases = useGlueDatabases();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");

  const filteredDatabases = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return databases.data ?? [];
    return (databases.data ?? []).filter((database) => database.name.toLowerCase().includes(needle));
  }, [databases.data, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter databases"
            className="pl-8"
          />
        </div>
        <Button type="button" variant="outline" size="icon" onClick={onRefresh} aria-label="Refresh catalog">
          <RefreshCw className={cn("size-4", databases.isFetching && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {databases.isLoading ? <p className="p-3 text-sm text-muted-foreground">Loading databases...</p> : null}
        {databases.error ? <p className="p-3 text-sm text-destructive">Failed to load databases.</p> : null}
        {!databases.isLoading && filteredDatabases.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No databases found.</p>
        ) : null}
        <ul className="divide-y">
          {filteredDatabases.map((database) => (
            <DatabaseNode
              key={database.name}
              database={database}
              expanded={expanded[database.name] ?? false}
              selectedDatabase={selectedDatabase}
              selectedTable={selectedTable}
              onToggle={() => setExpanded((current) => ({ ...current, [database.name]: !current[database.name] }))}
              onSelectTable={onSelectTable}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function DatabaseNode({
  database,
  expanded,
  selectedDatabase,
  selectedTable,
  onToggle,
  onSelectTable
}: {
  database: GlueDatabase;
  expanded: boolean;
  selectedDatabase?: string;
  selectedTable?: string;
  onToggle: () => void;
  onSelectTable: (databaseName: string, tableName: string) => void;
}) {
  const tables = useGlueTables(expanded ? database.name : undefined);

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <Database className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{database.name}</span>
      </button>
      {expanded ? (
        <ul className="border-t bg-muted/20">
          {tables.isLoading ? <li className="px-8 py-2 text-xs text-muted-foreground">Loading tables...</li> : null}
          {tables.error ? <li className="px-8 py-2 text-xs text-destructive">Failed to load tables.</li> : null}
          {(tables.data ?? []).map((table) => {
            const active = selectedDatabase === database.name && selectedTable === table.name;
            return (
              <li key={table.name}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 py-2 pr-3 pl-8 text-left text-sm hover:bg-accent",
                    active && "bg-primary/10 text-primary"
                  )}
                  onClick={() => onSelectTable(database.name, table.name)}
                >
                  <Table2 className="size-4 shrink-0" />
                  <span className="truncate">{table.name}</span>
                </button>
              </li>
            );
          })}
          {!tables.isLoading && (tables.data?.length ?? 0) === 0 ? (
            <li className="px-8 py-2 text-xs text-muted-foreground">No tables in this database.</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}
