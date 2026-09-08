import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Loader2, Play, RefreshCw, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDbDatabases, useDbTables, useRunDbQuery } from "@/hooks/useDbHub";
import { formatAppError } from "@/services/appErrorMessage";
import {
  readDbWorkspace,
  writeDbWorkspace,
  type CachedResultTab
} from "@/services/dbWorkspaceCache";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import type { DbConnection, DbQueryResult } from "@/types/domain";
import { cn } from "@/lib/utils";

/**
 * The per-connection query workspace rendered in the dynamic second-level tabs
 * (design section 4). Follows the Glue workspace layout — catalog tree on the
 * left, SQL editor and results on the right — with per-dialect metadata reads
 * instead of Glue.
 *
 * State lives in two layers (design section 7): React state for the live
 * editing experience, and the local workspace cache keyed by
 * (accountId, connectionId) as the persistence layer. The cache is written on
 * every change and rehydrated on mount, so switching accounts or leaving the
 * page and coming back restores the draft, the last selection and result-tab
 * metadata (big result bodies are dropped; a rerun restores them).
 */
export function ConnectionQueryTab({ connection }: { connection: DbConnection }) {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const runQuery = useRunDbQuery();
  const [selectedDatabase, setSelectedDatabase] = useState<string>();
  const [sql, setSql] = useState("SELECT 1;");
  const [resultTabs, setResultTabs] = useState<CachedResultTab[]>([]);
  const [activeResultId, setActiveResultId] = useState<string>();
  const [hydrated, setHydrated] = useState(false);
  const [running, setRunning] = useState(false);

  // Rehydrate once per mount+account: switching AWS accounts swaps the cache
  // key space, so each account's draft is restored independently. The tree
  // selection persists with the workspace as well.
  useEffect(() => {
    if (!accountId) return;
    const state = readDbWorkspace(accountId, connection.id);
    setSql(state.sql || "SELECT 1;");
    setResultTabs(state.resultTabs);
    setActiveResultId(state.activeResultTabId ?? state.resultTabs.at(-1)?.id);
    setSelectedDatabase(state.selectedDatabase);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, connection.id]);

  // Persist every state change (cache layer fits result bodies to a budget).
  useEffect(() => {
    if (!hydrated || !accountId) return;
    writeDbWorkspace(accountId, connection.id, {
      sql,
      activeResultTabId: activeResultId,
      resultTabs,
      selectedDatabase
    });
  }, [accountId, connection.id, hydrated, sql, resultTabs, activeResultId, selectedDatabase]);

  const databases = useDbDatabases(connection.id);
  const tables = useDbTables(connection.id, selectedDatabase);

  const activeResult = useMemo(
    () => resultTabs.find((tab) => tab.id === activeResultId) ?? resultTabs.at(-1),
    [activeResultId, resultTabs]
  );

  const handleRun = useCallback(
    async (sqlOverride?: string) => {
      const statement = sqlOverride ?? sql;
      if (!statement.trim()) return;
      setRunning(true);
      try {
        const result = await runQuery.mutateAsync({
          connectionId: connection.id,
          sql: statement
        });
        const tab: CachedResultTab = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: buildTitle(statement),
          sql: statement,
          ranAt: new Date().toISOString(),
          durationMs: result.durationMs,
          result
        };
        setResultTabs((tabs) => [...tabs.slice(-9), tab]);
        setActiveResultId(tab.id);
      } catch (error) {
        toast.error(formatAppError(error, "Query failed."));
      } finally {
        setRunning(false);
      }
    },
    [connection.id, runQuery, sql]
  );

  const handleSelectTable = (table: string) => {
    const tableRef = selectedDatabase ? `${selectedDatabase}.${table}` : table;
    setSql(`SELECT * FROM ${tableRef} LIMIT 100;`);
  };

  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
      <CatalogPane
        databases={databases.data ?? []}
        tables={tables.data ?? []}
        selectedDatabase={selectedDatabase}
        loadingDatabases={databases.isLoading}
        loadingTables={tables.isLoading}
        error={databases.error ?? tables.error}
        onSelectDatabase={setSelectedDatabase}
        onSelectTable={handleSelectTable}
      />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Database className="size-3.5 text-muted-foreground" aria-hidden />
            {connection.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {connection.kind} · read-only · {connection.enabledForAi ? "enabled for AI" : "manual"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  disabled={running || runQuery.isPending}
                  onClick={() => void handleRun()}
                >
                  {running ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Run
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Run · the read-only gate blocks every non-SELECT statement
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <SqlPane value={sql} onChange={setSql} onRun={() => void handleRun()} />

        <ResultPane result={activeResult?.result} meta={activeResult} rerunning={running} />
      </section>
    </div>
  );
}

function buildTitle(sql: string) {
  const firstLine = sql.trim().split("\n")[0] ?? sql.trim();
  const trimmed = firstLine.replace(/;+\s*$/, "");
  return trimmed.length > 32 ? `${trimmed.slice(0, 29)}…` : trimmed;
}

function CatalogPane({
  databases,
  tables,
  selectedDatabase,
  loadingDatabases,
  loadingTables,
  error,
  onSelectDatabase,
  onSelectTable
}: {
  databases: Array<{ name: string; kind?: string }>;
  tables: Array<{ name: string; kind?: string }>;
  selectedDatabase?: string;
  loadingDatabases: boolean;
  loadingTables: boolean;
  error: unknown;
  onSelectDatabase: (name: string) => void;
  onSelectTable: (name: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = tables.filter((table) =>
    table.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="border-b p-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter tables…"
          className="h-7 text-xs"
          aria-label="Filter tables"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
        {error ? <p className="text-xs text-destructive">Metadata unavailable.</p> : null}
        {loadingDatabases ? <SkeletonRows /> : null}
        {databases.map((database) => (
          <button
            key={database.name}
            type="button"
            onClick={() => onSelectDatabase(database.name)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs",
              database.name === selectedDatabase
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-secondary/60"
            )}
          >
            <Database className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{database.name}</span>
          </button>
        ))}
        <div className="my-1 border-t" />
        {loadingTables ? <SkeletonRows /> : null}
        {filtered.map((table) => (
          <button
            key={table.name}
            type="button"
            onClick={() => onSelectTable(table.name)}
            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-secondary/60"
          >
            <Table2 className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{table.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-1 p-1" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-3.5 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function SqlPane({
  value,
  onChange,
  onRun
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onRun();
    }
  };
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      spellCheck={false}
      rows={5}
      aria-label="SQL editor"
      className="w-full shrink-0 resize-none rounded-lg border bg-background p-3 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

function ResultPane({
  result,
  meta,
  rerunning
}: {
  result?: DbQueryResult;
  meta?: CachedResultTab;
  rerunning: boolean;
}) {
  if (!meta) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Run a query to see results here.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <div className="flex shrink-0 items-center gap-2 border-b bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="truncate font-medium text-foreground">{meta.title}</span>
        {meta.durationMs !== undefined ? <span>{meta.durationMs}ms</span> : null}
        {result ? (
          <span>
            {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
            {result.truncated ? " · truncated" : ""}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            results not cached
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-xs"
              disabled={rerunning}
              onClick={() => undefined}
            >
              <RefreshCw className="size-3" aria-hidden />
              rerun to restore
            </Button>
          </span>
        )}
      </div>
      {result ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-background">
              <tr>
                {result.columns.map((column) => (
                  <th
                    key={column}
                    className="border-b px-2 py-1.5 text-left font-medium"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index} className="odd:bg-secondary/20">
                  {result.columns.map((column) => (
                    <td key={column} className="max-w-64 truncate px-2 py-1">
                      {formatCell(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No rows.</p>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          The result set exceeded the local cache budget, so only this tab&apos;s
          metadata was kept. Run the query again to load fresh results.
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
