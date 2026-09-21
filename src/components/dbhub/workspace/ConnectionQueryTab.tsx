import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Braces,
  CalendarClock,
  Database,
  Eye,
  Folder,
  ListFilter,
  Loader2,
  PanelLeftOpen,
  Square,
  Table2
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { DbKindIcon } from "@/components/dbhub/DbKindIcon";
import { DbAnalyzeDialog } from "@/components/dbhub/workspace/DbAnalyzeDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useCountDbQuery,
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
import { QueryTabsPanel } from "@/components/dbhub/workspace/QueryTabsPanel";
import { ResultPane, lastPageOffset, previousPageOffset } from "@/components/dbhub/result/ResultPane";
import { AiMark, ExecuteMark, ExecuteNewTabMark } from "@/components/dbhub/workspace/RunMarks";
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
  MAX_QUERY_TABS,
  MAX_RESULT_TABS,
  blankQueryTab,
  readDbWorkspace,
  writeDbWorkspace,
  type CachedQueryTab,
  type CachedResultTab
} from "@/services/dbWorkspaceCache";
import { executeSqlToolName } from "@/services/aiAnalyzeDb";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useT } from "@/i18n";
import { useSessionStore } from "@/stores/sessionStore";
import type {
  DbCatalogEntry,
  DbConnection,
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
 * The right-hand side is two strips of tabs, one inside the other: the outer
 * holds the editor tabs (each an SQL draft of its own) and the inner holds the
 * result tabs of whichever editor is on screen. That nesting is the point —
 * an editor's results belong to the editor, so closing it closes them, and
 * two drafts open side by side never overwrite each other's grid.
 *
 * State lives in two layers (design section 7): React state for the live
 * editing experience, and the local workspace cache keyed by
 * (accountId, connectionId) as the persistence layer. The cache is written on
 * every change and rehydrated on mount, so switching accounts or leaving the
 * page and coming back restores every draft, the last selection and result-tab
 * metadata (big result bodies are dropped; a rerun restores them).
 */
export function ConnectionQueryTab({
  connection,
  active = true,
  onOpenAiAssistant
}: {
  connection: DbConnection;
  /** Catalog reads start when this dynamic tab becomes visible. */
  active?: boolean;
  /** Jump to the AI Assistant Chat tab after queuing a DB analysis intent. */
  onOpenAiAssistant?: () => void;
}) {
  const t = useT();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const setPendingDbAnalyze = useSessionStore((state) => state.setPendingDbAnalyze);
  const runQuery = useRunDbQuery();
  const countQuery = useCountDbQuery();
  const refreshCatalog = useRefreshDbCatalog(connection.id);
  const cancelQuery = useCancelDbQuery();
  const [selectedDatabase, setSelectedDatabase] = useState<string>();
  const [selectedSchema, setSelectedSchema] = useState<string>();
  const [selectedTable, setSelectedTable] = useState<string>();
  const [queryTabs, setQueryTabs] = useState<CachedQueryTab[]>([]);
  const [activeQueryTabId, setActiveQueryTabId] = useState<string>();
  const [hydrated, setHydrated] = useState(false);
  const [running, setRunning] = useState(false);
  /** Which result tab the in-flight run belongs to, so only it shows the marker. */
  const [runningTabId, setRunningTabId] = useState<string>();
  /** Which result tab is being counted, so only its button spins. */
  const [countingTabId, setCountingTabId] = useState<string>();
  /** The in-flight run's handle, for the stop button to name. */
  const [activeRequestId, setActiveRequestId] = useState<string>();
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<SqlFavoriteEntry[]>([]);
  /** The history entry a name is being asked for, when favouriting one. */
  const [favoritePrompt, setFavoritePrompt] = useState<SqlHistoryEntry>();
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [objectKinds, setObjectKinds] = useState<SchemaObjectKind[]>(
    DEFAULT_SCHEMA_OBJECT_KINDS
  );
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);
  const [catalogPaneWidth, setCatalogPaneWidth] = useState(240);

  // Rehydrate once per mount+account: switching AWS accounts swaps the cache
  // key space, so each account's drafts are restored independently. The tree
  // selection persists with the workspace as well.
  useEffect(() => {
    if (!accountId) return;
    const state = readDbWorkspace(accountId, connection.id);
    // A workspace always has at least one editor: an empty strip has nowhere
    // to type, and every run needs an editor to land in.
    const tabs = state.queryTabs.length ? state.queryTabs : [blankQueryTab()];
    setQueryTabs(tabs);
    setActiveQueryTabId(
      tabs.some((tab) => tab.id === state.activeQueryTabId)
        ? state.activeQueryTabId
        : tabs[0].id
    );
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
      queryTabs,
      activeQueryTabId,
      selectedDatabase,
      selectedSchema,
      catalogCollapsed,
      objectKinds
    });
  }, [
    accountId,
    connection.id,
    hydrated,
    queryTabs,
    activeQueryTabId,
    selectedDatabase,
    selectedSchema,
    catalogCollapsed,
    objectKinds
  ]);

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

  const activeQueryTab = useMemo(
    () => queryTabs.find((tab) => tab.id === activeQueryTabId) ?? queryTabs[0],
    [activeQueryTabId, queryTabs]
  );

  /** Replace one editor tab where it sits, or append it — the strip keeps order. */
  const patchQueryTab = useCallback((id: string, patch: Partial<CachedQueryTab>) => {
    setQueryTabs((tabs) => tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  /** The SQL on screen — every writer of it goes through here. */
  const setEditorSql = useCallback(
    (next: string) => {
      if (activeQueryTab) patchQueryTab(activeQueryTab.id, { sql: next });
    },
    [activeQueryTab, patchQueryTab]
  );

  /** Replace one result tab in place, or append it. */
  const patchResultTab = useCallback(
    (queryTabId: string, resultTabId: string, patch: Partial<CachedResultTab>) => {
      setQueryTabs((tabs) =>
        tabs.map((tab) =>
          tab.id === queryTabId
            ? {
                ...tab,
                resultTabs: tab.resultTabs.map((entry) =>
                  entry.id === resultTabId ? { ...entry, ...patch } : entry
                )
              }
            : tab
        )
      );
    },
    []
  );

  /**
   * Put a result tab into an editor, and follow it there.
   *
   * A tab that is not in the strip yet costs a number (`nextResultIndex`);
   * one that is already there is a rerun or a page and keeps the name it has,
   * so rerunning "Result 2" does not quietly turn it into "Result 3".
   */
  const putResultTab = useCallback(
    (queryTabId: string, tab: CachedResultTab, focus: boolean) => {
      setQueryTabs((tabs) =>
        tabs.map((editor) => {
          if (editor.id !== queryTabId) return editor;
          const known = editor.resultTabs.some((entry) => entry.id === tab.id);
          return {
            ...editor,
            resultTabs: known
              ? editor.resultTabs.map((entry) => (entry.id === tab.id ? tab : entry))
              : [...editor.resultTabs, tab].slice(-MAX_RESULT_TABS),
            activeResultTabId: focus ? tab.id : editor.activeResultTabId,
            nextResultIndex: known ? editor.nextResultIndex : editor.nextResultIndex + 1
          };
        })
      );
    },
    []
  );

  /**
   * Run a statement into one of an editor's result tabs.
   *
   * `mode` decides which: `"replace"` lands in the tab on screen — creating one
   * if the editor has none yet — and `"new"` always opens a fresh one.
   * `targetId` names a tab outright, which is what paging does: a later page
   * belongs to the tab it came from, wherever the user has since clicked.
   */
  const execute = useCallback(
    async (
      statement: string,
      queryTabId: string,
      options: { mode?: "replace" | "new"; targetId?: string; offset?: number } = {}
    ) => {
      if (!statement.trim()) return;
      const editor = queryTabs.find((tab) => tab.id === queryTabId);
      if (!editor) return;

      const offset = options.offset ?? 0;
      const paging = offset > 0;
      const reuseId = paging
        ? options.targetId
        : options.mode === "new"
          ? undefined
          : (options.targetId ?? editor.activeResultTabId);
      const existing = reuseId
        ? editor.resultTabs.find((tab) => tab.id === reuseId)
        : undefined;
      // A page whose tab has been closed has nowhere to land; the rows it
      // would hold belong to a result the user has already dismissed.
      if (paging && !existing) return;

      const resultTabId = existing?.id ?? crypto.randomUUID();
      const title = existing?.title ?? `Result ${editor.nextResultIndex}`;
      const requestId = crypto.randomUUID();
      setRunning(true);
      setRunningTabId(resultTabId);
      setActiveRequestId(requestId);
      try {
        const result = await runQuery.mutateAsync({
          connectionId: connection.id,
          sql: statement,
          maxRows: editor.fetchSize,
          offset,
          requestId
        });
        const ranAt = new Date().toISOString();
        if (paging) {
          // A page replaces the rows before it rather than joining them: the
          // strip offers a previous page, and an appended page has no "before".
          patchResultTab(queryTabId, resultTabId, {
            result,
            ranAt,
            durationMs: result.durationMs,
            runState: undefined,
            runError: undefined
          });
        } else {
          // Only a run that finished enters the history: a cancelled or failed
          // statement is not something to offer back.
          if (accountId) {
            setHistory(dbSqlStore.addHistory(dbSqlScope(accountId, connection.id), statement));
          }
          putResultTab(
            queryTabId,
            {
              id: resultTabId,
              title,
              sql: statement,
              ranAt,
              durationMs: result.durationMs,
              result,
              // A rerun is a new result set: keep how the grid was arranged,
              // because the sort is the user's reading of the data, but drop
              // the row count and the selected record — both describe rows that
              // are no longer here. The record panel is arrangement, not a row:
              // the new page keeps it open, it just starts again from the top
              // of it.
              view: existing?.view,
              singleRecord: existing?.singleRecord,
              sort: existing?.sort,
              runState: undefined,
              runError: undefined
            },
            true
          );
        }
        // The run may have dropped the very table the tree is showing. The
        // backend has already forgotten its copy; this forgets the WebView's.
        if (result.catalogChanged) void refreshCatalog();
      } catch (error) {
        const appError = error as { code?: string; message?: string };
        const cancelled = appError?.code === "Cancelled";
        if (existing) {
          patchResultTab(queryTabId, resultTabId, {
            runState: cancelled ? "cancelled" : "failed",
            runError: cancelled ? undefined : appError?.message
          });
        } else if (cancelled) {
          // Nothing to mark and nothing to apologise for — but a run the user
          // stopped did happen, and a strip that says nothing at all would
          // leave them wondering whether the click landed. So it gets the tab
          // it would have filled, saying only that it was stopped.
          putResultTab(
            queryTabId,
            {
              id: resultTabId,
              title,
              sql: statement,
              ranAt: new Date().toISOString(),
              runState: "cancelled"
            },
            true
          );
        } else {
          // A failure with no tab to record it in is only a toast: opening a
          // tab to hold an error would spend a "Result N" on a statement that
          // never returned anything, and the toast already says what went
          // wrong.
          toast.error(formatAppError(error, "Query failed."));
        }
      } finally {
        setRunning(false);
        setRunningTabId(undefined);
        setActiveRequestId(undefined);
      }
    },
    [
      accountId,
      connection.id,
      patchResultTab,
      putResultTab,
      queryTabs,
      refreshCatalog,
      runQuery
    ]
  );

  /** Stop the run in flight. The backend answers `false` if it already ended. */
  const handleStop = () => {
    if (activeRequestId) void cancelQuery(activeRequestId);
  };

  /** Step a result tab to another page of the same statement. */
  const handlePage = (queryTabId: string, tab: CachedResultTab, offset: number) => {
    if (offset < 0) return;
    void execute(tab.sql, queryTabId, { targetId: tab.id, offset });
  };

  const handleExport = async (tab: CachedResultTab, format: "csv" | "json") => {
    if (!tab.result) return;
    try {
      const name = tab.title || "result";
      const body =
        format === "csv"
          ? toCsv(tab.result.columns, tab.result.rows)
          : JSON.stringify(tab.result.rows, null, 2);
      await saveTextFile(`${name}.${format}`, body);
    } catch (error) {
      toast.error(formatAppError(error, "Failed to export the result."));
    }
  };

  /**
   * How many rows the statement would return — asked for, never assumed.
   *
   * The count re-runs the whole statement inside a `COUNT(*)`, so on a
   * warehouse it costs what the query costs. It is a button for that reason,
   * and a count that fails leaves the reason on the tab rather than replacing
   * a number the user already had.
   */
  const handleCount = async (queryTabId: string, tab: CachedResultTab) => {
    if (!tab.sql.trim()) return;
    setCountingTabId(tab.id);
    try {
      const counted = await countQuery.mutateAsync({
        connectionId: connection.id,
        sql: tab.sql
      });
      patchResultTab(queryTabId, tab.id, { totalCount: counted.count, countError: undefined });
    } catch (error) {
      const message = formatAppError(error, "Failed to count the rows.");
      patchResultTab(queryTabId, tab.id, { countError: message });
      toast.error(message);
    } finally {
      setCountingTabId(undefined);
    }
  };

  /**
   * Which tab a run lands in: a plain run replaces the result on screen and a
   * run-in-new-tab gets a result of its own, both inside the editor that is
   * currently open.
   */
  const handleRun = (statement?: string) => {
    if (!activeQueryTab) return;
    void execute(statement ?? activeQueryTab.sql, activeQueryTab.id, { mode: "replace" });
  };
  const handleRunNewTab = (statement?: string) => {
    if (!activeQueryTab) return;
    void execute(statement ?? activeQueryTab.sql, activeQueryTab.id, { mode: "new" });
  };

  /** Open an editor of its own, and put the cursor in it. */
  const openQueryTab = () => {
    const fresh = blankQueryTab(nextQueryTitle(queryTabs));
    setQueryTabs((tabs) => [...tabs, fresh].slice(-MAX_QUERY_TABS));
    setActiveQueryTabId(fresh.id);
  };

  /** Closing an editor takes its results with it — that is what owning them means. */
  const closeQueryTab = (tabId: string) => {
    const kept = queryTabs.filter((tab) => tab.id !== tabId);
    if (kept.length === 0) {
      // Never leave nowhere to type: the last editor closes into a fresh one.
      const fresh = blankQueryTab();
      setQueryTabs([fresh]);
      setActiveQueryTabId(fresh.id);
      return;
    }
    setQueryTabs(kept);
    if (tabId === activeQueryTab?.id) setActiveQueryTabId(kept[kept.length - 1].id);
  };

  /** Closing the last result tab leaves the editor with none, not with a blank one. */
  const closeResultTab = (queryTabId: string, resultTabId: string) => {
    setQueryTabs((tabs) =>
      tabs.map((editor) => {
        if (editor.id !== queryTabId) return editor;
        const kept = editor.resultTabs.filter((tab) => tab.id !== resultTabId);
        return {
          ...editor,
          resultTabs: kept,
          activeResultTabId:
            resultTabId === editor.activeResultTabId ? kept[kept.length - 1]?.id : editor.activeResultTabId
        };
      })
    );
  };

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
      setEditorSql(entry.name);
      setSelectedTable(undefined);
      return;
    }
    setSelectedTable(entry.name);
    // Qualify by schema, not by database: Postgres rejects `database.table`
    // outright, and on MySQL the schema *is* the database, so the qualifier is
    // the same word either way. Empty means the engine has no such level.
    const qualifier = activeSchema || (skipsSchemaLevel ? selectedDatabase : undefined);
    const reference = [qualifier, entry.name]
      .filter((part): part is string => Boolean(part))
      .map((part) => quoteIdentifier(connection.kind, part))
      .join(".");
    setEditorSql(`SELECT * FROM ${reference} LIMIT 100;`);
  };

  const analyzeFocusLabel =
    selectedTable ?? selectedSchema ?? selectedDatabase ?? connection.name;

  const openAnalyzeDialog = () => {
    if (!onOpenAiAssistant) return;
    if (!connection.enabledForAi) {
      toast.error(
        "Enable this connection for AI on the DBHub Overview card first — otherwise Chat has no SQL tool for it."
      );
      return;
    }
    const toolName = executeSqlToolName(connection.name);
    if (!toolName) {
      toast.error(
        "Connection name must contain letters or digits so Chat can register execute_sql_<slug>."
      );
      return;
    }
    setAnalyzeOpen(true);
  };

  const confirmAnalyze = (instruction: string) => {
    const toolName = executeSqlToolName(connection.name);
    if (!toolName || !onOpenAiAssistant) return;
    setPendingDbAnalyze({
      connectionId: connection.id,
      connectionName: connection.name,
      toolName,
      database: selectedDatabase,
      schema: selectedSchema,
      table: selectedTable,
      instruction
    });
    setAnalyzeOpen(false);
    onOpenAiAssistant();
  };

  const toggleObjectKind = (kind: SchemaObjectKind, on: boolean) => {
    setObjectKinds((kinds) =>
      on ? [...kinds, kind] : kinds.filter((entry) => entry !== kind)
    );
  };

  const analyzeButton = onOpenAiAssistant ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          aria-label={t("Analyze with AI")}
          onClick={openAnalyzeDialog}
        >
          <AiMark />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("Analyze with AI · opens Chat with this connection's context")}</TooltipContent>
    </Tooltip>
  ) : null;

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
                aria-label={t("Expand catalog panel")}
                onClick={() => setCatalogCollapsed(false)}
              >
                <PanelLeftOpen className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Show catalog")}{" · "}{CATALOG_TOGGLE_SHORTCUT}</TooltipContent>
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
        onSelectDatabase={(name) => {
          setSelectedDatabase(name);
          setSelectedTable(undefined);
        }}
        onSelectSchema={(name) => {
          setSelectedSchema(name);
          setSelectedTable(undefined);
        }}
        onSelectObject={handleSelectObject}
        onBack={() => {
          // One level at a time: schema → database → every database.
          if (selectedSchema !== undefined) {
            setSelectedSchema(undefined);
            setSelectedTable(undefined);
          } else {
            setSelectedDatabase(undefined);
            setSelectedTable(undefined);
          }
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
            <DbKindIcon kind={connection.kind} className="size-3.5" />
            {connection.name}
          </span>
          <Badge
            variant={connection.allowWrites ? "destructive" : "outline"}
            className="text-[10px]"
          >
            {t(connection.allowWrites ? "Write" : "Read-only")}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {connection.kind} ·{" "}
            {t(connection.allowWrites ? "writes allowed here" : "the AI reads this one")} ·{" "}
            {t(connection.enabledForAi ? "enabled for AI" : "manual")}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {analyzeButton}
            <SqlTemplatesButton
              templates={dbSqlTemplates(connection.kind)}
              onSelect={setEditorSql}
            />
            <HistoryMenu
              history={history}
              favoriteSqlSet={new Set(favorites.map((entry) => entry.sql.trim()))}
              onSelect={(entry) => setEditorSql(entry.sql)}
              onFavorite={setFavoritePrompt}
            />
            <FavoritesMenu
              favorites={favorites}
              onSelect={(entry) => setEditorSql(entry.sql)}
              onRemove={(favoriteId) => {
                if (accountId) {
                  setFavorites(
                    dbSqlStore.removeFavorite(dbSqlScope(accountId, connection.id), favoriteId)
                  );
                }
              }}
            />
            {/* Stays in the toolbar as well as the result strip: a first run
                has no result tab yet, so the strip's Stop is not on screen
                when a query is slow enough to want stopping. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={!running}
                  aria-label={t("Stop query")}
                  onClick={handleStop}
                >
                  <Square className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("Stop query")}{" · "}{t("stops reading; the server notices when the connection closes")}
              </TooltipContent>
            </Tooltip>
            {/* The two marks below are the whole point of the toolbar, so they
                are drawn rather than borrowed from the icon set — see RunMarks. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={running || runQuery.isPending}
                  aria-label={t("Run in new tab")}
                  onClick={() => void handleRunNewTab()}
                >
                  <ExecuteNewTabMark />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("Run in new tab")}{" · "}{t("the result opens as its own tab beside this one")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  className="size-7"
                  disabled={running || runQuery.isPending}
                  aria-label={t("Run query")}
                  onClick={() => void handleRun()}
                >
                  {running ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ExecuteMark />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("Run query")}{" · "}{t("the read-only gate blocks every non-SELECT statement")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {activeQueryTab ? (
          <QueryTabsPanel
            tabs={queryTabs}
            activeTabId={activeQueryTab.id}
            onSelectTab={setActiveQueryTabId}
            onCloseTab={closeQueryTab}
            onNewTab={openQueryTab}
          >
            {(queryTab) => (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                {/* Keyed by editor: each tab is its own CodeMirror document, so
                    undo in one never reaches into another's text. */}
                <SqlEditor
                  key={queryTab.id}
                  value={queryTab.sql}
                  onChange={(next) => patchQueryTab(queryTab.id, { sql: next })}
                  dialect={dialectFor(connection.kind)}
                  placeholder={t("Write {kind} SQL here…", { kind: connection.kind })}
                  onRun={(statement) => void execute(statement, queryTab.id, { mode: "replace" })}
                  onRunNewTab={(statement) => void execute(statement, queryTab.id, { mode: "new" })}
                />

                <div className="min-h-0 flex-1 overflow-hidden">
                  <ResultTabsPanel
                    tabs={queryTab.resultTabs.map((tab) => ({
                      ...tab,
                      tooltip: tab.sql || tab.title,
                      running: running && tab.id === runningTabId
                    }))}
                    activeTabId={queryTab.activeResultTabId ?? ""}
                    onSelectTab={(resultTabId) =>
                      patchQueryTab(queryTab.id, { activeResultTabId: resultTabId })
                    }
                    onCloseTab={(resultTabId) => closeResultTab(queryTab.id, resultTabId)}
                    emptyLabel={t("Run a query to see results here.")}
                  >
                    {(tab) => (
                      <ResultPane
                        key={tab.id}
                        meta={tab}
                        result={tab.result}
                        running={running && tab.id === runningTabId}
                        counting={countingTabId === tab.id}
                        offset={tab.result?.offset ?? 0}
                        fetchSize={queryTab.fetchSize}
                        onPatch={(patch) => patchResultTab(queryTab.id, tab.id, patch)}
                        onFetchSizeChange={(size) => patchQueryTab(queryTab.id, { fetchSize: size })}
                        onRefresh={() => handlePage(queryTab.id, tab, 0)}
                        onFirst={() => handlePage(queryTab.id, tab, 0)}
                        onPrev={() =>
                          handlePage(
                            queryTab.id,
                            tab,
                            previousPageOffset(tab.result?.offset ?? 0, queryTab.fetchSize)
                          )
                        }
                        onNext={() => {
                          const next = tab.result?.nextOffset;
                          if (next != null) handlePage(queryTab.id, tab, next);
                        }}
                        onLast={() => {
                          const last = lastPageOffset(tab, queryTab.fetchSize);
                          if (last !== undefined) handlePage(queryTab.id, tab, last);
                        }}
                        onExport={(format) => void handleExport(tab, format)}
                        onStop={handleStop}
                        onCount={() => void handleCount(queryTab.id, tab)}
                        analyzeButton={analyzeButton}
                      />
                    )}
                  </ResultTabsPanel>
                </div>
              </div>
            )}
          </QueryTabsPanel>
        ) : null}
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

      <DbAnalyzeDialog
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        connectionName={connection.name}
        focusLabel={analyzeFocusLabel}
        onConfirm={confirmAnalyze}
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

/**
 * What the next editor tab is called. Numbered from the highest one in use
 * rather than from the count, so closing "Query 2" does not hand its name to
 * the next tab while a "Query 3" is still open beside it.
 */
function nextQueryTitle(tabs: CachedQueryTab[]): string {
  const used = tabs
    .map((tab) => /^Query (\d+)$/.exec(tab.title)?.[1])
    .filter((index): index is string => index !== undefined)
    .map(Number);
  return `Query ${(used.length ? Math.max(...used) : 0) + 1}`;
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
  const t = useT();
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
        backLabel={inDatabase ? t("Back one level") : undefined}
        onBack={onBack}
        filter={filter}
        onFilterChange={setFilter}
        filterPlaceholder={t(inDatabase ? "Filter tables" : "Filter databases")}
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
            {t(!inDatabase ? "No databases." : inSchemaList ? "No schemas." : "No tables.")}
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
  const t = useT();
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
              aria-label={t("Choose what to show")}
            >
              <ListFilter className="size-3" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {t("Showing {selected} of {total} object kinds", {
            selected: selected.length,
            total: options.length
          })}
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

