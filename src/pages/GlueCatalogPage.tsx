import {
  ChevronDown,
  History,
  PanelLeftOpen,
  Play,
  Square,
  Star,
  Trash2
} from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CatalogTree } from "@/components/glue/CatalogTree";
import { AthenaQueryOptionsBar } from "@/components/glue/AthenaQueryOptionsBar";
import { QueryResultTabsPanel } from "@/components/glue/QueryResultTabsPanel";
import { TableMetadataPanel } from "@/components/glue/TableMetadataPanel";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useAthenaQueryExecution,
  useExportAthenaQueryCsv,
  useStartAthenaQuery,
  useStopAthenaQuery,
  useAthenaWorkgroups
} from "@/hooks/useAthena";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useGlueTable, useUpdateGlueTable } from "@/hooks/useGlue";
import { useSubmitUser } from "@/hooks/useJobConfigTemplates";
import { useAthenaAccountPreferences } from "@/hooks/useAthenaAccountPreferences";
import {
  displayAthenaResultsPath,
  isAthenaManagedResultsWorkgroup,
  isAthenaOutputPathRequired,
  resolveAthenaOutputLocation,
  resolveAthenaQueryOutputLocation
} from "@/services/athenaOutputPath";
import { formatAppError } from "@/services/appErrorMessage";
import { athenaService } from "@/services/athenaService";
import { buildDropTableSql, buildSelectSql, SQL_DDL_TEMPLATES } from "@/services/glueSqlTemplates";
import {
  addSqlFavorite,
  addSqlHistory,
  readSqlFavorites,
  readSqlHistory,
  removeSqlFavorite
} from "@/services/sqlQueryStorage";
import {
  buildResultTabTitle,
  createQueryResultTab,
  type QueryResultTab
} from "@/services/queryResultTabs";
import type { AthenaQueryResults, SqlFavoriteEntry, SqlHistoryEntry } from "@/types/domain";
import { useQueryClient } from "@tanstack/react-query";

const WORKSPACE_PANE_MIN_WIDTH = 220;
const WORKSPACE_PANE_DEFAULT_WIDTH = 300;

type TopTab = "query" | "metadata";

const initialResultTab = createQueryResultTab(1);

export function GlueCatalogPage() {
  const queryClient = useQueryClient();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const submitUserQuery = useSubmitUser();
  const submitUser = submitUserQuery.data ?? "user";

  const [topTab, setTopTab] = useState<TopTab>("query");
  const [catalogViewDatabase, setCatalogViewDatabase] = useState<string | undefined>();
  const [selectedDatabase, setSelectedDatabase] = useState<string>();
  const [selectedTable, setSelectedTable] = useState<string>();
  const [sql, setSql] = useState("SELECT 1;");
  const athenaPrefs = useAthenaAccountPreferences(accountId);
  const outputBasePath = athenaPrefs.outputBasePath;
  const appendSubmitUser = athenaPrefs.appendSubmitUser;
  const workgroup = athenaPrefs.workgroup;
  const catalogCollapsed = athenaPrefs.catalogCollapsed;
  const [resultTabs, setResultTabs] = useState<QueryResultTab[]>([initialResultTab]);
  const [activeResultTabId, setActiveResultTabId] = useState(initialResultTab.id);
  const [metadataEditMode, setMetadataEditMode] = useState(false);
  const [catalogPaneWidth, setCatalogPaneWidth] = useState(WORKSPACE_PANE_DEFAULT_WIDTH);
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<SqlFavoriteEntry[]>([]);
  const [dropDialogOpen, setDropDialogOpen] = useState(false);
  const loadedResultsRef = useRef<Set<string>>(new Set());
  const restoredCatalogAccountRef = useRef<string | undefined>();

  const activeResultTab = useMemo(
    () => resultTabs.find((tab) => tab.id === activeResultTabId) ?? resultTabs[0],
    [activeResultTabId, resultTabs]
  );

  const updateResultTab = useCallback((tabId: string, patch: Partial<QueryResultTab>) => {
    setResultTabs((tabs) => tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const tableDetail = useGlueTable(
    selectedDatabase && selectedTable
      ? { databaseName: selectedDatabase, tableName: selectedTable }
      : undefined
  );
  const updateTable = useUpdateGlueTable();
  const startQuery = useStartAthenaQuery();
  const stopQuery = useStopAthenaQuery();
  const exportCsv = useExportAthenaQueryCsv();
  const workgroups = useAthenaWorkgroups();
  const execution = useAthenaQueryExecution(
    activeResultTab?.queryExecutionId,
    Boolean(activeResultTab?.queryExecutionId)
  );

  const effectiveOutputLocation = useMemo(
    () => resolveAthenaOutputLocation(outputBasePath, submitUser, appendSubmitUser),
    [appendSubmitUser, outputBasePath, submitUser]
  );

  const selectedWorkgroup = useMemo(
    () => workgroups.data?.find((entry) => entry.name === workgroup),
    [workgroups.data, workgroup]
  );

  const managedResultsEnabled = isAthenaManagedResultsWorkgroup(selectedWorkgroup);

  const outputPathRequired = useMemo(
    () => isAthenaOutputPathRequired(selectedWorkgroup, effectiveOutputLocation),
    [effectiveOutputLocation, selectedWorkgroup]
  );

  const queryOutputLocation = useMemo(
    () => resolveAthenaQueryOutputLocation(effectiveOutputLocation),
    [effectiveOutputLocation]
  );

  const displayResultsPath = useMemo(
    () => displayAthenaResultsPath(selectedWorkgroup, effectiveOutputLocation),
    [effectiveOutputLocation, selectedWorkgroup]
  );

  const handleRefreshCatalog = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["glue-databases", accountId] });
    void queryClient.invalidateQueries({ queryKey: ["glue-tables", accountId] });
    if (selectedDatabase) {
      void queryClient.invalidateQueries({ queryKey: ["glue-table", accountId, selectedDatabase, selectedTable] });
    }
  }, [accountId, queryClient, selectedDatabase, selectedTable]);

  useEffect(() => {
    if (!accountId) {
      restoredCatalogAccountRef.current = undefined;
      setCatalogViewDatabase(undefined);
      setSelectedDatabase(undefined);
      setSelectedTable(undefined);
      return;
    }
    setHistory(readSqlHistory(accountId));
    setFavorites(readSqlFavorites(accountId));
  }, [accountId]);

  useEffect(() => {
    if (!athenaPrefs.ready || !accountId) return;
    if (restoredCatalogAccountRef.current === accountId) return;
    restoredCatalogAccountRef.current = accountId;

    const restored = athenaPrefs.lastDatabase;
    if (restored) {
      setCatalogViewDatabase(restored);
      setSelectedDatabase(restored);
    }
  }, [athenaPrefs.ready, accountId, athenaPrefs.lastDatabase]);

  const loadResultsForTab = useCallback(
    async (tabId: string, executionId: string, nextToken?: string) => {
      updateResultTab(tabId, { resultsLoading: true, resultsError: undefined });
      try {
        const page = await athenaService.getQueryResults({
          accountId,
          queryExecutionId: executionId,
          nextToken,
          maxResults: 1000
        });
        setResultTabs((tabs) =>
          tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            return {
              ...tab,
              results: mergeResultPages(tab.results, page, Boolean(nextToken)),
              resultsLoading: false
            };
          })
        );
      } catch (error) {
        updateResultTab(tabId, { resultsLoading: false, resultsError: error });
      }
    },
    [accountId, updateResultTab]
  );

  useEffect(() => {
    if (!activeResultTabId || !execution.data) return;
    updateResultTab(activeResultTabId, { execution: execution.data });
  }, [activeResultTabId, execution.data, updateResultTab]);

  useEffect(() => {
    if (!activeResultTabId || execution.data?.state !== "SUCCEEDED") return;
    const executionId = activeResultTab?.queryExecutionId;
    if (!executionId) return;
    if (loadedResultsRef.current.has(executionId)) return;
    loadedResultsRef.current.add(executionId);
    void loadResultsForTab(activeResultTabId, executionId);
    if (isCatalogMutatingSql(activeResultTab?.sqlSnapshot ?? "")) {
      handleRefreshCatalog();
    }
  }, [
    activeResultTab?.queryExecutionId,
    activeResultTab?.sqlSnapshot,
    activeResultTabId,
    execution.data?.state,
    loadResultsForTab,
    handleRefreshCatalog
  ]);

  useEffect(() => {
    setMetadataEditMode(false);
  }, [selectedDatabase, selectedTable]);

  const handleSelectTable = (databaseName: string, tableName: string) => {
    setCatalogViewDatabase(databaseName);
    setSelectedDatabase(databaseName);
    setSelectedTable(tableName);
    athenaPrefs.setLastDatabase(databaseName);
    if (topTab === "query") {
      setSql(buildSelectSql(databaseName, tableName));
    }
  };

  const handleFocusDatabase = (databaseName: string) => {
    setCatalogViewDatabase(databaseName);
    setSelectedDatabase(databaseName);
    setSelectedTable(undefined);
    athenaPrefs.setLastDatabase(databaseName);
  };

  const handleExitDatabase = () => {
    setCatalogViewDatabase(undefined);
    setSelectedDatabase(undefined);
    setSelectedTable(undefined);
  };

  const executeQueryOnTab = async (tabId: string, sqlToRun: string) => {
    if (!accountId) return;
    if (selectedWorkgroup?.sparkEnabled) {
      toast.error(
        "The selected workgroup is Spark-enabled. Choose an Athena SQL workgroup to run queries here."
      );
      return;
    }
    if (outputPathRequired) {
      toast.error("Set an Athena results S3 path before running a query.");
      return;
    }

    updateResultTab(tabId, {
      sqlSnapshot: sqlToRun,
      title: buildResultTabTitle(sqlToRun, resultTabs.length),
      results: undefined,
      resultsError: undefined,
      resultsLoading: false,
      queryExecutionId: undefined,
      execution: undefined
    });

    try {
      const started = await startQuery.mutateAsync({
        sql: sqlToRun,
        workgroup,
        outputLocation: queryOutputLocation,
        database: selectedDatabase
      });
      updateResultTab(tabId, {
        queryExecutionId: started.queryExecutionId,
        execution: started
      });
      setHistory(addSqlHistory(accountId, sqlToRun));
      toast.success("Athena query started.");
    } catch (error) {
      toast.error(formatAppError(error, "Failed to start Athena query."));
    }
  };

  const handleRunQuery = () => {
    if (!activeResultTabId) return;
    void executeQueryOnTab(activeResultTabId, sql);
  };

  const handleRunQueryInNewTab = () => {
    const newTab = createQueryResultTab(resultTabs.length + 1);
    setResultTabs((tabs) => [...tabs, newTab]);
    setActiveResultTabId(newTab.id);
    void executeQueryOnTab(newTab.id, sql);
  };

  const handleStopQuery = async () => {
    const executionId = activeResultTab?.queryExecutionId;
    if (!executionId) return;
    try {
      await stopQuery.mutateAsync({ queryExecutionId: executionId });
      toast.success("Athena query cancelled.");
    } catch (error) {
      toast.error(formatAppError(error, "Failed to stop Athena query."));
    }
  };

  const handleExport = async (tabId: string) => {
    const tab = resultTabs.find((entry) => entry.id === tabId);
    if (!tab?.queryExecutionId) return;
    try {
      const savedPath = await exportCsv.mutateAsync({
        queryExecutionId: tab.queryExecutionId,
        suggestedName: "athena-query-results.csv"
      });
      if (savedPath) {
        toast.success(`Exported CSV to ${savedPath}`);
      }
    } catch (error) {
      toast.error(formatAppError(error, "Failed to export query results."));
    }
  };

  const closeResultTab = (tabId: string) => {
    if (resultTabs.length <= 1) {
      const fresh = createQueryResultTab(1);
      setResultTabs([fresh]);
      setActiveResultTabId(fresh.id);
      return;
    }
    const nextTabs = resultTabs.filter((tab) => tab.id !== tabId);
    setResultTabs(nextTabs);
    if (activeResultTabId === tabId) {
      setActiveResultTabId(nextTabs[0]?.id ?? "");
    }
  };

  const cycleResultTab = (delta: number) => {
    if (resultTabs.length <= 1) return;
    const index = resultTabs.findIndex((tab) => tab.id === activeResultTabId);
    if (index < 0) return;
    const nextIndex = (index + delta + resultTabs.length) % resultTabs.length;
    setActiveResultTabId(resultTabs[nextIndex].id);
  };

  const handleSaveMetadata = async (table: NonNullable<typeof tableDetail.data>) => {
    try {
      await updateTable.mutateAsync({ table });
      setMetadataEditMode(false);
      toast.success("Table metadata updated.");
    } catch (error) {
      toast.error(formatAppError(error, "Failed to update table metadata."));
    }
  };

  const handleDropTable = async () => {
    if (!selectedDatabase || !selectedTable) return;
    const dropSql = buildDropTableSql(selectedDatabase, selectedTable);
    setSql(dropSql);
    setDropDialogOpen(false);
    setTopTab("query");
    try {
      const started = await startQuery.mutateAsync({
        sql: dropSql,
        workgroup,
        outputLocation: queryOutputLocation,
        database: selectedDatabase
      });
      updateResultTab(activeResultTabId, {
        queryExecutionId: started.queryExecutionId,
        sqlSnapshot: dropSql,
        title: buildResultTabTitle(dropSql),
        execution: started,
        results: undefined,
        resultsError: undefined
      });
      if (accountId) {
        setHistory(addSqlHistory(accountId, dropSql));
      }
      setSelectedTable(undefined);
      toast.success("Drop table query started.");
      handleRefreshCatalog();
    } catch (error) {
      toast.error(formatAppError(error, "Failed to drop table."));
    }
  };

  const loadFavorite = (entry: SqlFavoriteEntry) => {
    setSql(entry.sql);
    setTopTab("query");
  };
  const loadHistoryEntry = (entry: SqlHistoryEntry) => {
    setSql(entry.sql);
    setTopTab("query");
  };

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

  const favoriteCurrentSql = () => {
    if (!accountId) return;
    const name = window.prompt("Favorite name", "Saved query");
    if (!name) return;
    setFavorites(addSqlFavorite(accountId, name, sql));
    toast.success("SQL saved to favorites.");
  };

  const running =
    activeResultTab?.execution?.state === "QUEUED" || activeResultTab?.execution?.state === "RUNNING";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRunQueryInNewTab();
        } else {
          handleRunQuery();
        }
        return;
      }

      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        cycleResultTab(1);
        return;
      }

      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        cycleResultTab(-1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col gap-4 overflow-hidden">
      <PageHeader
        pageId="glue"
        actions={
          topTab === "metadata" && selectedDatabase && selectedTable ? (
            <Button type="button" variant="destructive" size="sm" onClick={() => setDropDialogOpen(true)}>
              <Trash2 data-icon="inline-start" />
              Drop table
            </Button>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        {catalogCollapsed ? (
          <div className="flex shrink-0 flex-col items-center">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Expand catalog panel"
              title="Show catalog"
              onClick={() => athenaPrefs.setCatalogCollapsed(false)}
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <section
              className="flex min-h-0 shrink-0 flex-col overflow-hidden"
              style={{ width: catalogPaneWidth }}
            >
              <CatalogTree
                viewDatabase={catalogViewDatabase}
                selectedDatabase={selectedDatabase}
                selectedTable={selectedTable}
                onFocusDatabase={handleFocusDatabase}
                onExitDatabase={handleExitDatabase}
                onSelectTable={handleSelectTable}
                onRefresh={handleRefreshCatalog}
                onCollapse={() => athenaPrefs.setCatalogCollapsed(true)}
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

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Tabs
            value={topTab}
            onValueChange={(value) => setTopTab(value as TopTab)}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <TabsList className="shrink-0 self-start">
              <TabsTrigger value="query">Query</TabsTrigger>
              <TabsTrigger value="metadata">Table Metadata</TabsTrigger>
            </TabsList>

            <TabsContent value="query" className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <AthenaQueryOptionsBar
                workgroup={workgroup}
                onWorkgroupChange={athenaPrefs.setWorkgroup}
                outputBasePath={outputBasePath}
                onOutputBasePathChange={athenaPrefs.setOutputBasePath}
                appendSubmitUser={appendSubmitUser}
                onAppendSubmitUserChange={athenaPrefs.setAppendSubmitUser}
                submitUser={submitUser}
                displayResultsPath={displayResultsPath}
                managedResultsEnabled={managedResultsEnabled}
                outputPathRequired={outputPathRequired}
                preferencesReady={athenaPrefs.ready}
              />

              <div className="flex flex-wrap gap-2">
                  <Select
                    onValueChange={(value) => {
                      const template = SQL_DDL_TEMPLATES.find((entry) => entry.label === value);
                      if (template) setSql(template.sql);
                    }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="SQL templates" />
                    </SelectTrigger>
                    <SelectContent>
                      {SQL_DDL_TEMPLATES.map((template) => (
                        <SelectItem key={template.label} value={template.label}>
                          {template.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <HistoryMenu history={history} onSelect={loadHistoryEntry} />
                  <FavoritesMenu
                    favorites={favorites}
                    onSelect={loadFavorite}
                    onRemove={(favoriteId) => accountId && setFavorites(removeSqlFavorite(accountId, favoriteId))}
                  />

                  <Button type="button" variant="outline" size="sm" onClick={favoriteCurrentSql}>
                    <Star data-icon="inline-start" />
                    Favorite SQL
                  </Button>

                  <div className="ml-auto flex gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={!running} onClick={handleStopQuery}>
                      <Square data-icon="inline-start" />
                      Stop
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={startQuery.isPending || running}
                      onClick={handleRunQueryInNewTab}
                      title="Run in new tab (Ctrl/Cmd+Shift+Enter)"
                    >
                      <Play data-icon="inline-start" />
                      New tab
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={startQuery.isPending || running}
                      onClick={handleRunQuery}
                      title="Run (Ctrl/Cmd+Enter)"
                    >
                      <Play data-icon="inline-start" />
                      Run
                    </Button>
                  </div>
                </div>

                <Textarea
                  value={sql}
                  onChange={(event) => setSql(event.target.value)}
                  rows={8}
                  className="min-h-[140px] shrink-0 rounded-lg border font-mono text-[11px] leading-snug"
                  spellCheck={false}
                />

              <div className="min-h-0 flex-1 overflow-hidden">
                <QueryResultTabsPanel
                  tabs={resultTabs}
                  activeTabId={activeResultTabId}
                  onSelectTab={setActiveResultTabId}
                  onCloseTab={closeResultTab}
                  onLoadMore={(tabId) => {
                    const tab = resultTabs.find((entry) => entry.id === tabId);
                    if (tab?.queryExecutionId) {
                      void loadResultsForTab(tabId, tab.queryExecutionId, tab.results?.nextToken);
                    }
                  }}
                  onExport={(tabId) => void handleExport(tabId)}
                  exporting={exportCsv.isPending}
                />
              </div>
              <p className="shrink-0 text-[11px] text-muted-foreground">
                Shortcuts: Run ⌘/Ctrl+Enter · New tab ⌘/Ctrl+Shift+Enter · Prev/Next result tab ⌘/Ctrl+Alt+←/→
              </p>
            </TabsContent>

            <TabsContent value="metadata" className="mt-0 min-h-0 flex-1 overflow-auto rounded-lg border p-3">
              <TableMetadataPanel
                table={tableDetail.data}
                loading={tableDetail.isLoading}
                error={tableDetail.error}
                editMode={metadataEditMode}
                onEditModeChange={setMetadataEditMode}
                onSave={handleSaveMetadata}
                saving={updateTable.isPending}
              />
            </TabsContent>
          </Tabs>
        </section>
      </div>

      <Dialog open={dropDialogOpen} onOpenChange={setDropDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop table?</DialogTitle>
            <DialogDescription>
              This runs `DROP TABLE IF EXISTS {selectedDatabase}.{selectedTable}` in Athena and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDropDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDropTable}>
              Drop table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryMenu({
  history,
  onSelect
}: {
  history: SqlHistoryEntry[];
  onSelect: (entry: SqlHistoryEntry) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <History data-icon="inline-start" />
          History
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        {history.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No recent queries yet.</p>
        ) : (
          <ul className="max-h-72 overflow-auto divide-y">
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-accent"
                  onClick={() => onSelect(entry)}
                >
                  <p className="truncate font-mono text-xs">{entry.sql}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(entry.submittedAt).toLocaleString()}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FavoritesMenu({
  favorites,
  onSelect,
  onRemove
}: {
  favorites: SqlFavoriteEntry[];
  onSelect: (entry: SqlFavoriteEntry) => void;
  onRemove: (favoriteId: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Star data-icon="inline-start" />
          Favorites
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        {favorites.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No favorite queries yet.</p>
        ) : (
          <ul className="max-h-72 overflow-auto divide-y">
            {favorites.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 px-3 py-2">
                <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => onSelect(entry)}>
                  <p className="truncate text-sm font-medium">{entry.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{entry.sql}</p>
                </button>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove favorite" onClick={() => onRemove(entry.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function mergeResultPages(current: AthenaQueryResults | undefined, page: AthenaQueryResults, append: boolean) {
  if (!append || !current) {
    return page;
  }
  return {
    columnNames: page.columnNames.length ? page.columnNames : current.columnNames,
    rows: [...current.rows, ...page.rows],
    nextToken: page.nextToken
  };
}

function clampPaneWidth(width: number) {
  return Math.min(720, Math.max(WORKSPACE_PANE_MIN_WIDTH, width));
}

function isCatalogMutatingSql(value: string) {
  const normalized = value.trim().toUpperCase();
  return (
    normalized.startsWith("CREATE ") ||
    normalized.startsWith("ALTER ") ||
    normalized.startsWith("DROP ") ||
    normalized.startsWith("MSCK ")
  );
}
