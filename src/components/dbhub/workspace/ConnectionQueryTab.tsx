import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Folder, Loader2, Play, Plus, RefreshCw, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDbDatabases,
  useDbSchemas,
  useDbTables,
  useRefreshDbCatalog,
  useRunDbQuery
} from "@/hooks/useDbHub";
import { SqlEditor } from "@/components/sql/SqlEditor";
import { ResultTabsPanel } from "@/components/sql/ResultTabsPanel";
import { MySQL, PostgreSQL } from "@codemirror/lang-sql";
import { buildResultTabTitle } from "@/services/queryResultTabs";
import { CatalogRow } from "@/components/catalog/CatalogRow";
import { CatalogToolbar } from "@/components/catalog/CatalogToolbar";
import { formatAppError } from "@/services/appErrorMessage";
import {
  readDbWorkspace,
  writeDbWorkspace,
  type CachedResultTab
} from "@/services/dbWorkspaceCache";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import type { DbConnection, DbQueryResult } from "@/types/domain";

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
export function ConnectionQueryTab({
  connection,
  active = true
}: {
  connection: DbConnection;
  /** Catalog reads start when this dynamic tab becomes visible. */
  active?: boolean;
}) {
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const runQuery = useRunDbQuery();
  const refreshCatalog = useRefreshDbCatalog();
  const [selectedDatabase, setSelectedDatabase] = useState<string>();
  const [selectedSchema, setSelectedSchema] = useState<string>();
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
    setResultTabs(state.resultTabs.length ? state.resultTabs : [blankTab()]);
    setActiveResultId(state.activeResultTabId ?? state.resultTabs.at(-1)?.id);
    // If the connection declares a default database and the workspace has no
    // remembered selection, land inside it so the tree shows its tables
    // immediately (user request, mirroring how Glue restores a catalog view).
    setSelectedDatabase(state.selectedDatabase ?? connection.database);
    setSelectedSchema(state.selectedSchema);
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
      selectedDatabase,
      selectedSchema
    });
  }, [accountId, connection.id, hydrated, sql, resultTabs, activeResultId, selectedDatabase, selectedSchema]);

  const databases = useDbDatabases(connection.id, active);
  const schemas = useDbSchemas(connection.id, selectedDatabase, active);

  // A level holding exactly one choice is a click for nothing — and an engine
  // with no schema level at all answers with none. Either way the tree goes
  // straight to tables and the schema becomes whatever that single entry was
  // (empty for MySQL, which reads tables by the database the dial names).
  const schemaList = schemas.data ?? [];
  const skipsSchemaLevel = schemas.isSuccess && schemaList.length <= 1;
  const activeSchema = skipsSchemaLevel
    ? (schemaList[0]?.name ?? "")
    : selectedSchema;

  const tables = useDbTables(connection.id, selectedDatabase, activeSchema, active);

  const activeResult = useMemo(
    () => resultTabs.find((tab) => tab.id === activeResultId) ?? resultTabs.at(-1),
    [activeResultId, resultTabs]
  );

  /** Replace a tab where it sits, or append it — the strip keeps its order. */
  const upsertTab = useCallback((tab: CachedResultTab) => {
    setResultTabs((tabs) => {
      const at = tabs.findIndex((entry) => entry.id === tab.id);
      if (at < 0) return [...tabs, tab].slice(-MAX_RESULT_TABS);
      const next = [...tabs];
      next[at] = tab;
      return next;
    });
  }, []);

  const execute = useCallback(
    async (statement: string, tabId?: string) => {
      if (!statement.trim()) return;
      const id = tabId ?? crypto.randomUUID();
      setRunning(true);
      try {
        const result = await runQuery.mutateAsync({
          connectionId: connection.id,
          sql: statement
        });
        upsertTab({
          id,
          title: buildResultTabTitle(statement, resultTabs.length + 1),
          sql: statement,
          ranAt: new Date().toISOString(),
          durationMs: result.durationMs,
          result
        });
        setActiveResultId(id);
      } catch (error) {
        toast.error(formatAppError(error, "Query failed."));
      } finally {
        setRunning(false);
      }
    },
    [connection.id, runQuery, resultTabs.length, upsertTab]
  );

  /**
   * Which tab a run lands in, following the Glue workspace: a plain run
   * replaces what the tab on screen held, and a run-in-new-tab gets its own.
   */
  const handleRun = (sqlOverride?: string) => void execute(sqlOverride ?? sql, activeResult?.id);
  const handleRunNewTab = (sqlOverride?: string) => void execute(sqlOverride ?? sql);

  /** Closing the last tab leaves a blank one, so the strip is never empty. */
  const closeResultTab = (tabId: string) => {
    setResultTabs((tabs) => {
      const kept = tabs.filter((tab) => tab.id !== tabId);
      if (kept.length > 0) {
        if (tabId === activeResultId) setActiveResultId(kept.at(-1)?.id);
        return kept;
      }
      const fresh = blankTab();
      setActiveResultId(fresh.id);
      return [fresh];
    });
  };

  /** What the strip renders: five scalars, not the whole cached tab. */
  const stripTabs = useMemo(
    () =>
      resultTabs.map((tab) => ({
        ...tab,
        tooltip: tab.sql || tab.title,
        running: running && tab.id === activeResult?.id
      })),
    [resultTabs, running, activeResult]
  );

  const handleSelectTable = (table: string) => {
    // Qualify by schema, not by database: Postgres rejects `database.table`
    // outright, and on MySQL the schema *is* the database, so the qualifier is
    // the same word either way. Empty means the engine has no such level.
    const qualifier = activeSchema || (skipsSchemaLevel ? selectedDatabase : undefined);
    const tableRef = qualifier ? `${qualifier}.${table}` : table;
    setSql(`SELECT * FROM ${tableRef} LIMIT 100;`);
  };

  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
      <CatalogPane
        databases={databases.data ?? []}
        schemas={schemaList}
        tables={tables.data ?? []}
        selectedDatabase={selectedDatabase}
        selectedSchema={activeSchema}
        skipsSchemaLevel={skipsSchemaLevel}
        loadingDatabases={databases.isLoading}
        loadingSchemas={schemas.isLoading}
        loadingTables={tables.isLoading}
        refreshing={databases.isFetching || schemas.isFetching || tables.isFetching}
        error={databases.error ?? schemas.error ?? tables.error}
        onSelectDatabase={setSelectedDatabase}
        onSelectSchema={setSelectedSchema}
        onSelectTable={handleSelectTable}
        onBack={() => {
          // One level at a time: schema → database → every database.
          if (selectedSchema !== undefined) setSelectedSchema(undefined);
          else setSelectedDatabase(undefined);
        }}
        onRefresh={refreshCatalog}
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
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={running || runQuery.isPending}
                  aria-label="Run in new tab"
                  onClick={() => void handleRunNewTab()}
                >
                  <Plus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Run in new tab</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  className="size-7"
                  disabled={running || runQuery.isPending}
                  aria-label="Run query"
                  onClick={() => void handleRun()}
                >
                  {running ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Run query · the read-only gate blocks every non-SELECT statement
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <SqlEditor
          value={sql}
          onChange={setSql}
          dialect={dialectFor(connection.kind)}
          placeholder={`Write ${connection.kind} SQL here…`}
          onRun={() => void handleRun()}
          onRunNewTab={() => void handleRunNewTab()}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          <ResultTabsPanel
            tabs={stripTabs}
            activeTabId={activeResult?.id ?? ""}
            onSelectTab={setActiveResultId}
            onCloseTab={closeResultTab}
          >
            {(tab) => (
              <ResultPane
                key={tab.id}
                result={tab.result}
                meta={tab}
                rerunning={running}
                onRerun={() => void handleRun(tab.sql)}
              />
            )}
          </ResultTabsPanel>
        </div>
      </section>
    </div>
  );
}

/**
 * The dialect the editor highlights with. Yellowbrick speaks the Postgres
 * wire, so it reads as Postgres here the same way it does in the driver.
 */
function dialectFor(kind: DbConnection["kind"]) {
  return kind === "mysql" ? MySQL : PostgreSQL;
}

/** How many result tabs a workspace keeps before the oldest rolls off. */
const MAX_RESULT_TABS = 10;

/**
 * A tab to stand in before anything has run — and the one closing the last
 * result leaves behind, so the strip always has something to show.
 */
function blankTab(): CachedResultTab {
  return { id: `blank-${Date.now()}`, title: "Result 1", sql: "", ranAt: "" };
}

function CatalogPane({
  databases,
  schemas,
  tables,
  selectedDatabase,
  selectedSchema,
  skipsSchemaLevel,
  loadingDatabases,
  loadingSchemas,
  loadingTables,
  refreshing,
  error,
  onSelectDatabase,
  onSelectSchema,
  onSelectTable,
  onBack,
  onRefresh
}: {
  databases: Array<{ name: string; kind?: string }>;
  schemas: Array<{ name: string; kind?: string }>;
  tables: Array<{ name: string; kind?: string }>;
  selectedDatabase?: string;
  selectedSchema?: string;
  /** One schema (or none) is a level with nothing to choose — skip it. */
  skipsSchemaLevel: boolean;
  loadingDatabases: boolean;
  loadingSchemas: boolean;
  loadingTables: boolean;
  /** Any level currently refetching — drives the toolbar's spinner. */
  refreshing: boolean;
  error: unknown;
  onSelectDatabase: (name: string) => void;
  onSelectSchema: (name: string) => void;
  onSelectTable: (name: string) => void;
  /** Step back one level: schema → database → all databases. */
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("");

  // The tree is a drill-down: databases, then schemas inside one (when there is
  // a choice to make), then that schema's tables.
  const inDatabase = Boolean(selectedDatabase);
  const inSchemaList = inDatabase && !skipsSchemaLevel && selectedSchema === undefined;
  const listing = inSchemaList ? schemas : inDatabase && !inSchemaList ? tables : databases;
  const loading = inSchemaList ? loadingSchemas : inDatabase && !inSchemaList ? loadingTables : loadingDatabases;
  const filtered = listing.filter((entry) =>
    entry.name.toLowerCase().includes(filter.toLowerCase())
  );
  const qualifier = selectedSchema ? `${selectedDatabase}.${selectedSchema}` : selectedDatabase;
  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Failed to load metadata."
    : undefined;

  const select = (name: string) => {
    if (!inDatabase) onSelectDatabase(name);
    else if (inSchemaList) onSelectSchema(name);
    else onSelectTable(name);
    setFilter("");
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-2 overflow-hidden">
      <CatalogToolbar
        backLabel={inDatabase ? "Back one level" : undefined}
        onBack={onBack}
        filter={filter}
        onFilterChange={setFilter}
        filterPlaceholder={inDatabase ? "Filter tables" : "Filter databases"}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-md border text-xs">
        {/* Which database and schema these rows belong to. The toolbar no
            longer has room to say it, and a drill-down that cannot tell you
            where you are is the one thing worse than no drill-down. */}
        {inDatabase ? (
          <div className="border-b bg-muted/30 px-1.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Database className="mr-1 inline size-3" aria-hidden />
            {qualifier}
          </div>
        ) : null}

        {errorMessage ? (
          <p className="p-2 text-xs leading-relaxed text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {loading ? <SkeletonRows /> : null}
        <ul className="divide-y">
          {filtered.map((entry) => (
            <li key={entry.name}>
              <CatalogRow
                name={entry.name}
                emphasis={!inDatabase}
                icon={
                  !inDatabase ? (
                    <Database className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : inSchemaList ? (
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Table2 className="size-3.5 shrink-0" aria-hidden />
                  )
                }
                onSelect={() => select(entry.name)}
              />
            </li>
          ))}
        </ul>
        {!loading && filtered.length === 0 && !errorMessage ? (
          <p className="p-2 text-xs text-muted-foreground">
            {!inDatabase ? "No databases." : inSchemaList ? "No schemas." : "No tables."}
          </p>
        ) : null}
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

function ResultPane({
  result,
  meta,
  rerunning,
  onRerun
}: {
  result?: DbQueryResult;
  meta?: CachedResultTab;
  rerunning: boolean;
  onRerun: () => void;
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
              onClick={onRerun}
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
