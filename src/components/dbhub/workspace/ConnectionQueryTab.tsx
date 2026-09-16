import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Braces,
  CalendarClock,
  Database,
  Download,
  Eye,
  Folder,
  ListFilter,
  Loader2,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Square,
  Table2
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDbDatabases,
  useDbSchemas,
  useDbObjects,
  useCancelDbQuery,
  useRefreshDbCatalog,
  useRunDbQuery
} from "@/hooks/useDbHub";
import { SqlEditor } from "@/components/sql/SqlEditor";
import { ResultTabsPanel } from "@/components/sql/ResultTabsPanel";
import { MySQL, PostgreSQL } from "@codemirror/lang-sql";
import { buildResultTabTitle } from "@/services/queryResultTabs";
import { SHORTCUT_IDS, getShortcutPrimaryKey } from "@/data/keyboardShortcuts";
import {
  FavoriteNameDialog,
  FavoritesMenu,
  HistoryMenu,
  SqlTemplatesButton
} from "@/components/glue/SqlQueryMenus";
import { dbSqlScope, dbSqlStore } from "@/services/dbSqlStorage";
import { dbSqlTemplates } from "@/services/dbSqlTemplates";
import {
  DEFAULT_SCHEMA_OBJECT_KINDS,
  isRelation,
  quoteIdentifier,
  schemaObjectOptions,
  type SchemaObjectOption
} from "@/services/schemaObjects";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CatalogRow } from "@/components/catalog/CatalogRow";
import { CatalogToolbar } from "@/components/catalog/CatalogToolbar";
import { formatAppError } from "@/services/appErrorMessage";
import { toCsv } from "@/services/dbCsv";
import { saveTextFile } from "@/services/fileDownload";
import {
  readDbWorkspace,
  writeDbWorkspace,
  type CachedResultTab
} from "@/services/dbWorkspaceCache";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import type {
  DbCatalogEntry,
  DbConnection,
  DbQueryResult,
  SqlFavoriteEntry,
  SchemaObjectKind,
  SqlHistoryEntry
} from "@/types/domain";

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
  const refreshCatalog = useRefreshDbCatalog(connection.id);
  const cancelQuery = useCancelDbQuery();
  const [selectedDatabase, setSelectedDatabase] = useState<string>();
  const [selectedSchema, setSelectedSchema] = useState<string>();
  const [sql, setSql] = useState("SELECT 1;");
  const [resultTabs, setResultTabs] = useState<CachedResultTab[]>([]);
  const [activeResultId, setActiveResultId] = useState<string>();
  const [hydrated, setHydrated] = useState(false);
  const [running, setRunning] = useState(false);
  /** Which tab the in-flight run belongs to, so only it shows the marker. */
  const [runningTabId, setRunningTabId] = useState<string>();
  /** The in-flight run's handle, for the stop button to name. */
  const [activeRequestId, setActiveRequestId] = useState<string>();
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<SqlFavoriteEntry[]>([]);
  /** The history entry a name is being asked for, when favouriting one. */
  const [favoritePrompt, setFavoritePrompt] = useState<SqlHistoryEntry>();
  const [objectKinds, setObjectKinds] = useState<SchemaObjectKind[]>(
    DEFAULT_SCHEMA_OBJECT_KINDS
  );
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);
  const [catalogPaneWidth, setCatalogPaneWidth] = useState(240);

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
    setCatalogCollapsed(state.catalogCollapsed ?? false);
    setObjectKinds(state.objectKinds ?? DEFAULT_SCHEMA_OBJECT_KINDS);
    // History and favourites live outside the workspace cache: they outlive a
    // draft and belong to the connection, not to this browser tab's session.
    const scope = dbSqlScope(accountId, connection.id);
    setHistory(dbSqlStore.readHistory(scope));
    setFavorites(dbSqlStore.readFavorites(scope));
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
      selectedSchema,
      catalogCollapsed,
      objectKinds
    });
  }, [accountId, connection.id, hydrated, sql, resultTabs, activeResultId, selectedDatabase, selectedSchema, catalogCollapsed, objectKinds]);

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

  const objects = useDbObjects(connection.id, selectedDatabase, activeSchema, objectKinds, active);

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

  const markTab = useCallback((id: string, patch: Partial<CachedResultTab>) => {
    setResultTabs((tabs) => tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  /** A later page joins the rows the tab already holds rather than replacing them. */
  const appendRows = useCallback((id: string, page: DbQueryResult) => {
    setResultTabs((tabs) =>
      tabs.map((tab) => {
        if (tab.id !== id || !tab.result) return tab;
        return {
          ...tab,
          result: {
            ...page,
            // A page past the end comes back with no rows and therefore no
            // column names; the first page's are still the right ones.
            columns: page.columns.length ? page.columns : tab.result.columns,
            rows: [...tab.result.rows, ...page.rows],
            rowCount: tab.result.rowCount + page.rowCount,
            offset: tab.result.offset
          }
        };
      })
    );
  }, []);

  const execute = useCallback(
    async (statement: string, tabId?: string, offset = 0) => {
      if (!statement.trim()) return;
      const id = tabId ?? crypto.randomUUID();
      const requestId = crypto.randomUUID();
      setRunning(true);
      setRunningTabId(id);
      setActiveRequestId(requestId);
      try {
        const result = await runQuery.mutateAsync({
          connectionId: connection.id,
          sql: statement,
          offset,
          requestId
        });
        if (offset > 0) {
          appendRows(id, result);
        } else {
          // Only a run that finished enters the history: a cancelled or failed
          // statement is not something to offer back.
          if (accountId) {
            setHistory(dbSqlStore.addHistory(dbSqlScope(accountId, connection.id), statement));
          }
          upsertTab({
            id,
            title: buildResultTabTitle(statement, resultTabs.length + 1),
            sql: statement,
            ranAt: new Date().toISOString(),
            durationMs: result.durationMs,
            result
          });
        }
        setActiveResultId(id);
        // The run may have dropped the very table the tree is showing. The
        // backend has already forgotten its copy; this forgets the WebView's.
        if (result.catalogChanged) void refreshCatalog();
      } catch (error) {
        const appError = error as { code?: string; message?: string };
        if (appError?.code === "Cancelled") {
          // A stopped run is a state, not a failure — it belongs in the tab,
          // not in a toast apologising for something the user asked for.
          markTab(id, { runState: "cancelled", runError: undefined });
        } else {
          markTab(id, { runState: "failed", runError: appError?.message });
          toast.error(formatAppError(error, "Query failed."));
        }
      } finally {
        setRunning(false);
        setRunningTabId(undefined);
        setActiveRequestId(undefined);
      }
    },
    [appendRows, connection.id, markTab, resultTabs.length, runQuery, upsertTab]
  );

  /** Stop the run in flight. The backend answers `false` if it already ended. */
  const handleStop = () => {
    if (activeRequestId) void cancelQuery(activeRequestId);
  };

  const handleLoadMore = (tab?: CachedResultTab) => {
    const offset = tab?.result?.nextOffset;
    if (!tab || offset == null) return;
    void execute(tab.sql, tab.id, offset);
  };

  const handleExport = async (tab: CachedResultTab) => {
    if (!tab.result) return;
    try {
      await saveTextFile(`${tab.title || "result"}.csv`, toCsv(tab.result.columns, tab.result.rows));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to export CSV."));
    }
  };

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
        running: running && tab.id === runningTabId
      })),
    [resultTabs, running, runningTabId]
  );

  // Only the visible workspace answers. The Glue tab is mounted for the life
  // of the page once opened, so both listeners fire from any sub-tab unless
  // each checks that it is the one on screen.
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "\\") return;
      event.preventDefault();
      setCatalogCollapsed((collapsed) => !collapsed);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  const beginCatalogPaneResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = catalogPaneWidth;

    const handleMove = (moveEvent: MouseEvent) => {
      setCatalogPaneWidth(clampPaneWidth(startWidth + moveEvent.clientX - startX));
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleSelectObject = (entry: DbCatalogEntry) => {
    // A routine is not something a `select * from` can name, and a `CALL`
    // would be refused by the read-only gate — so a click puts the name in the
    // editor and stops there, which is as far as it can honestly go.
    if (!isRelation(entry.kind)) {
      setSql(entry.name);
      return;
    }
    // Qualify by schema, not by database: Postgres rejects `database.table`
    // outright, and on MySQL the schema *is* the database, so the qualifier is
    // the same word either way. Empty means the engine has no such level.
    const qualifier = activeSchema || (skipsSchemaLevel ? selectedDatabase : undefined);
    const reference = [qualifier, entry.name]
      .filter((part): part is string => Boolean(part))
      .map((part) => quoteIdentifier(connection.kind, part))
      .join(".");
    setSql(`SELECT * FROM ${reference} LIMIT 100;`);
  };

  const toggleObjectKind = (kind: SchemaObjectKind, on: boolean) => {
    setObjectKinds((kinds) =>
      on ? [...kinds, kind] : kinds.filter((entry) => entry !== kind)
    );
  };

  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
      {catalogCollapsed ? (
        <div className="flex shrink-0 flex-col items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-7"
                aria-label="Expand catalog panel"
                onClick={() => setCatalogCollapsed(false)}
              >
                <PanelLeftOpen className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show catalog · {CATALOG_TOGGLE_SHORTCUT}</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <>
          <section
            className="flex min-h-0 shrink-0 flex-col overflow-hidden"
            style={{ width: catalogPaneWidth }}
          >
            <CatalogPane
        databases={databases.data ?? []}
        schemas={schemaList}
        objects={objects.data ?? []}
        selectedDatabase={selectedDatabase}
        selectedSchema={activeSchema}
        skipsSchemaLevel={skipsSchemaLevel}
        loadingDatabases={databases.isLoading}
        loadingSchemas={schemas.isLoading}
        loadingObjects={objects.isLoading}
        refreshing={databases.isFetching || schemas.isFetching || objects.isFetching}
        error={databases.error ?? schemas.error ?? objects.error}
        objectOptions={schemaObjectOptions(connection.kind)}
        objectKinds={objectKinds}
        onToggleObjectKind={toggleObjectKind}
        onSelectDatabase={setSelectedDatabase}
        onSelectSchema={setSelectedSchema}
        onSelectObject={handleSelectObject}
        onBack={() => {
          // One level at a time: schema → database → every database.
          if (selectedSchema !== undefined) setSelectedSchema(undefined);
          else setSelectedDatabase(undefined);
        }}
              onRefresh={refreshCatalog}
              onCollapse={() => setCatalogCollapsed(true)}
              collapseShortcut={CATALOG_TOGGLE_SHORTCUT}
            />
          </section>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={catalogPaneWidth}
            className="group relative w-2 shrink-0 cursor-col-resize touch-none"
            onMouseDown={beginCatalogPaneResize}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-primary/50" />
          </div>
        </>
      )}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Database className="size-3.5 text-muted-foreground" aria-hidden />
            {connection.name}
          </span>
          <Badge
            variant={connection.allowWrites ? "destructive" : "outline"}
            className="text-[10px]"
          >
            {connection.allowWrites ? "Write" : "Read-only"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {connection.kind} ·{" "}
            {connection.allowWrites ? "writes allowed here" : "the AI reads this one"} ·{" "}
            {connection.enabledForAi ? "enabled for AI" : "manual"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <SqlTemplatesButton
              templates={dbSqlTemplates(connection.kind)}
              onSelect={setSql}
            />
            <HistoryMenu
              history={history}
              favoriteSqlSet={new Set(favorites.map((entry) => entry.sql.trim()))}
              onSelect={(entry) => setSql(entry.sql)}
              onFavorite={setFavoritePrompt}
            />
            <FavoritesMenu
              favorites={favorites}
              onSelect={(entry) => setSql(entry.sql)}
              onRemove={(favoriteId) => {
                if (accountId) {
                  setFavorites(
                    dbSqlStore.removeFavorite(dbSqlScope(accountId, connection.id), favoriteId)
                  );
                }
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={!running}
                  aria-label="Stop query"
                  onClick={handleStop}
                >
                  <Square className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Stop query · stops reading; the server notices when the connection closes
              </TooltipContent>
            </Tooltip>
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
                onRerun={() => void execute(tab.sql, tab.id)}
                onLoadMore={() => handleLoadMore(tab)}
                onExport={() => void handleExport(tab)}
              />
            )}
          </ResultTabsPanel>
        </div>
      </section>

      <FavoriteNameDialog
        open={Boolean(favoritePrompt)}
        onOpenChange={(open) => {
          if (!open) setFavoritePrompt(undefined);
        }}
        defaultName={favoritePrompt?.sql.slice(0, 40)}
        onConfirm={(name) => {
          if (accountId && favoritePrompt) {
            setFavorites(
              dbSqlStore.addFavorite(
                dbSqlScope(accountId, connection.id),
                name,
                favoritePrompt.sql
              )
            );
          }
          setFavoritePrompt(undefined);
        }}
      />
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

/** The chord that shows and hides the catalog, shared with the Glue tab. */
const CATALOG_TOGGLE_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.GLUE_CATALOG_TOGGLE);

/** How narrow and how wide the catalog pane may be dragged. */
const MIN_CATALOG_WIDTH = 220;
const MAX_CATALOG_WIDTH = 720;
const clampPaneWidth = (width: number) =>
  Math.min(MAX_CATALOG_WIDTH, Math.max(MIN_CATALOG_WIDTH, width));

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
  objects,
  selectedDatabase,
  selectedSchema,
  skipsSchemaLevel,
  loadingDatabases,
  loadingSchemas,
  loadingObjects,
  refreshing,
  error,
  objectOptions,
  objectKinds,
  onToggleObjectKind,
  onSelectDatabase,
  onSelectSchema,
  onSelectObject,
  onBack,
  onRefresh,
  onCollapse,
  collapseShortcut
}: {
  databases: DbCatalogEntry[];
  schemas: DbCatalogEntry[];
  objects: DbCatalogEntry[];
  selectedDatabase?: string;
  selectedSchema?: string;
  /** One schema (or none) is a level with nothing to choose — skip it. */
  skipsSchemaLevel: boolean;
  loadingDatabases: boolean;
  loadingSchemas: boolean;
  loadingObjects: boolean;
  /** Any level currently refetching — drives the toolbar's spinner. */
  refreshing: boolean;
  error: unknown;
  /** What this engine can hold, and which of it the tree is showing. */
  objectOptions: SchemaObjectOption[];
  objectKinds: SchemaObjectKind[];
  onToggleObjectKind: (kind: SchemaObjectKind, on: boolean) => void;
  onSelectDatabase: (name: string) => void;
  onSelectSchema: (name: string) => void;
  onSelectObject: (entry: DbCatalogEntry) => void;
  /** Step back one level: schema → database → all databases. */
  onBack: () => void;
  onRefresh: () => void | Promise<void>;
  onCollapse: () => void;
  collapseShortcut: string;
}) {
  const [filter, setFilter] = useState("");

  // The tree is a drill-down: databases, then schemas inside one (when there is
  // a choice to make), then that schema's tables.
  const inDatabase = Boolean(selectedDatabase);
  const inSchemaList = inDatabase && !skipsSchemaLevel && selectedSchema === undefined;
  const listing = inSchemaList ? schemas : inDatabase && !inSchemaList ? objects : databases;
  const loading = inSchemaList
    ? loadingSchemas
    : inDatabase && !inSchemaList
      ? loadingObjects
      : loadingDatabases;
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

  const select = (entry: DbCatalogEntry) => {
    if (!inDatabase) onSelectDatabase(entry.name);
    else if (inSchemaList) onSelectSchema(entry.name);
    else onSelectObject(entry);
    setFilter("");
  };

  return (
    <aside className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <CatalogToolbar
        backLabel={inDatabase ? "Back one level" : undefined}
        onBack={onBack}
        filter={filter}
        onFilterChange={setFilter}
        filterPlaceholder={inDatabase ? "Filter tables" : "Filter databases"}
        onRefresh={() => void onRefresh()}
        refreshing={refreshing}
        onCollapse={onCollapse}
        collapseShortcut={collapseShortcut}
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-md border text-xs">
        {/* Which database and schema these rows belong to. The toolbar no
            longer has room to say it, and a drill-down that cannot tell you
            where you are is the one thing worse than no drill-down. */}
        {inDatabase ? (
          <div className="flex items-center gap-1 border-b bg-muted/30 px-1.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Database className="mr-1 inline size-3" aria-hidden />
            <span className="min-w-0 truncate">{qualifier}</span>
            {/* Only where there are objects to choose between: while the tree
                is still asking which schema, there is nothing to filter yet. */}
            {!inSchemaList ? (
              <ObjectKindMenu
                options={objectOptions}
                selected={objectKinds}
                onToggle={onToggleObjectKind}
              />
            ) : null}
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
                    <ObjectIcon kind={entry.kind} />
                  )
                }
                onSelect={() => select(entry)}
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

/** The mark next to an object, so a view is not drawn as a table. */
function ObjectIcon({ kind }: { kind?: SchemaObjectKind }) {
  if (kind === "view" || kind === "materialized-view") {
    return <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  }
  if (kind === "procedure" || kind === "function") {
    return <Braces className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  }
  if (kind === "event") {
    return <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return <Table2 className="size-3.5 shrink-0" aria-hidden />;
}

/**
 * Which object kinds the tree lists. Multi-select on purpose — looking at the
 * views and the tables together is a normal thing to want — and a popover
 * rather than a select because the list belongs to the schema you are in, not
 * to the page.
 */
function ObjectKindMenu({
  options,
  selected,
  onToggle
}: {
  options: SchemaObjectOption[];
  selected: SchemaObjectKind[];
  onToggle: (kind: SchemaObjectKind, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto size-5 shrink-0"
              aria-label="Choose what to show"
            >
              <ListFilter className="size-3" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Showing {selected.length} of {options.length} object kinds
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-56 p-1">
        <ul>
          {options.map((option) => (
            <li
              key={option.kind}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
            >
              <Checkbox
                id={`object-kind-${option.kind}`}
                checked={selected.includes(option.kind)}
                onCheckedChange={(checked) => onToggle(option.kind, checked === true)}
              />
              <Label htmlFor={`object-kind-${option.kind}`} className="text-xs font-normal">
                {option.label}
              </Label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-1 p-2" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-3.5 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

/**
 * One page of a result, with the two things a JDBC result can do that an
 * Athena one cannot: read the next page, and be stopped mid-flight. Both are
 * said in the user's terms — a page re-runs the query, and a cancelled run is
 * a state rather than a failure.
 */
function ResultPane({
  result,
  meta,
  rerunning,
  onRerun,
  onLoadMore,
  onExport
}: {
  result?: DbQueryResult;
  meta?: CachedResultTab;
  rerunning: boolean;
  onRerun: () => void;
  onLoadMore: () => void;
  onExport: () => void;
}) {
  if (!meta) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Run a query to see results here.
      </div>
    );
  }

  const state = meta.runState;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
        <span className="truncate font-medium text-foreground">{meta.title}</span>
        {state === "cancelled" ? <span>Cancelled</span> : null}
        {state === "failed" ? (
          <span className="text-destructive">
            Failed{meta.runError ? `: ${meta.runError}` : ""}
          </span>
        ) : null}
        {meta.durationMs !== undefined ? <span>{meta.durationMs}ms</span> : null}
        {result ? (
          <span>
            {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
            {result.truncated ? " · truncated" : ""}
            {result.offset > 0 ? ` · from row ${result.offset + 1}` : ""}
          </span>
        ) : null}
        {result ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto size-6"
                aria-label="Export CSV"
                onClick={onExport}
              >
                <Download className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Export CSV · the rows loaded here, not the whole result
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {result ? (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full border-collapse text-[10px]">
              <thead className="sticky top-0 z-10 bg-muted/80">
                <tr>
                  {result.columns.map((column) => (
                    <th key={column} className="border-b px-2 py-1 text-left font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index} className="odd:bg-secondary/20">
                    {result.columns.map((column) => (
                      <td key={column} className="max-w-xs truncate px-2 py-1 font-mono">
                        {formatCell(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">Query returned no rows.</p>
            ) : null}
          </div>

          {result.nextOffset != null ? (
            <div className="flex shrink-0 items-center gap-2 border-t px-2 py-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[10px]"
                disabled={rerunning}
                onClick={onLoadMore}
              >
                Load more rows
              </Button>
              {/* Said out loud because it is not obvious and it is not free:
                  there is no cursor to resume from, so each page re-runs the
                  statement and discards the rows it skips. */}
              <span className="text-[10px] text-muted-foreground">
                Each page re-runs the query. Add an ORDER BY so pages stay stable.
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
          <p>The result set exceeded the local cache budget, so only this tab's metadata was kept.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            disabled={rerunning}
            onClick={onRerun}
          >
            Rerun to load fresh results
          </Button>
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
