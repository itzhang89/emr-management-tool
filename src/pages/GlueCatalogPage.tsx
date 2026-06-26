import {
  ChevronDown,
  History,
  Play,
  Square,
  Star,
  Trash2
} from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CatalogTree } from "@/components/glue/CatalogTree";
import { QueryResultsPanel } from "@/components/glue/QueryResultsPanel";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useAthenaQueryExecution,
  useAthenaWorkgroups,
  useExportAthenaQueryCsv,
  useStartAthenaQuery,
  useStopAthenaQuery
} from "@/hooks/useAthena";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useGlueTable, useUpdateGlueTable } from "@/hooks/useGlue";
import { useSubmitUser } from "@/hooks/useJobConfigTemplates";
import { mergeAthenaPreferences, readAthenaPreferences } from "@/services/athenaPreferencesStorage";
import { resolveAthenaOutputLocation } from "@/services/athenaOutputPath";
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
import type { AthenaQueryResults, SqlFavoriteEntry, SqlHistoryEntry } from "@/types/domain";
import { useQueryClient } from "@tanstack/react-query";

const WORKSPACE_PANE_MIN_WIDTH = 220;
const WORKSPACE_PANE_DEFAULT_WIDTH = 300;

export function GlueCatalogPage() {
  const queryClient = useQueryClient();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const submitUserQuery = useSubmitUser();
  const submitUser = submitUserQuery.data ?? "user";

  const [selectedDatabase, setSelectedDatabase] = useState<string>();
  const [selectedTable, setSelectedTable] = useState<string>();
  const [sql, setSql] = useState("SELECT 1;");
  const [workgroup, setWorkgroup] = useState("primary");
  const [outputBasePath, setOutputBasePath] = useState("");
  const [appendSubmitUser, setAppendSubmitUser] = useState(true);
  const [queryExecutionId, setQueryExecutionId] = useState<string>();
  const [bottomTab, setBottomTab] = useState<"results" | "metadata">("results");
  const [metadataEditMode, setMetadataEditMode] = useState(false);
  const [catalogPaneWidth, setCatalogPaneWidth] = useState(WORKSPACE_PANE_DEFAULT_WIDTH);
  const [results, setResults] = useState<AthenaQueryResults>();
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<unknown>();
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<SqlFavoriteEntry[]>([]);
  const [dropDialogOpen, setDropDialogOpen] = useState(false);

  const tableDetail = useGlueTable(
    selectedDatabase && selectedTable
      ? { databaseName: selectedDatabase, tableName: selectedTable }
      : undefined
  );
  const updateTable = useUpdateGlueTable();
  const startQuery = useStartAthenaQuery();
  const stopQuery = useStopAthenaQuery();
  const exportCsv = useExportAthenaQueryCsv();
  const execution = useAthenaQueryExecution(queryExecutionId, Boolean(queryExecutionId));

  const effectiveOutputLocation = useMemo(
    () => resolveAthenaOutputLocation(outputBasePath, submitUser, appendSubmitUser),
    [appendSubmitUser, outputBasePath, submitUser]
  );

  useEffect(() => {
    if (!accountId) return;
    const preferences = readAthenaPreferences(accountId);
    setOutputBasePath(preferences.outputBasePath ?? "");
    setAppendSubmitUser(preferences.appendSubmitUser ?? true);
    setWorkgroup(preferences.lastWorkgroup ?? preferences.defaultWorkgroup ?? "primary");
    setHistory(readSqlHistory(accountId));
    setFavorites(readSqlFavorites(accountId));
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    mergeAthenaPreferences(accountId, {
      outputBasePath,
      appendSubmitUser,
      lastWorkgroup: workgroup
    });
  }, [accountId, appendSubmitUser, outputBasePath, workgroup]);

  const loadResultsPage = useCallback(
    async (executionId: string, nextToken?: string) => {
      setResultsLoading(true);
      setResultsError(undefined);
      try {
        const page = await athenaService.getQueryResults({
          accountId,
          queryExecutionId: executionId,
          nextToken,
          maxResults: 1000
        });
        setResults((current) => mergeResultPages(current, page, Boolean(nextToken)));
      } catch (error) {
        setResultsError(error);
      } finally {
        setResultsLoading(false);
      }
    },
    [accountId]
  );

  useEffect(() => {
    if (execution.data?.state !== "SUCCEEDED" || !queryExecutionId) return;
    void loadResultsPage(queryExecutionId);
    if (isCatalogMutatingSql(sql)) {
      handleRefreshCatalog();
    }
  }, [execution.data?.state, queryExecutionId, loadResultsPage, sql]);

  useEffect(() => {
    setMetadataEditMode(false);
  }, [selectedDatabase, selectedTable]);

  const handleSelectTable = (databaseName: string, tableName: string) => {
    setSelectedDatabase(databaseName);
    setSelectedTable(tableName);
    setSql(buildSelectSql(databaseName, tableName));
    setBottomTab("metadata");
  };

  const handleRefreshCatalog = () => {
    void queryClient.invalidateQueries({ queryKey: ["glue-databases", accountId] });
    void queryClient.invalidateQueries({ queryKey: ["glue-tables", accountId] });
    if (selectedDatabase) {
      void queryClient.invalidateQueries({ queryKey: ["glue-table", accountId, selectedDatabase, selectedTable] });
    }
  };

  const handleRunQuery = async () => {
    if (!accountId) return;
    if (!effectiveOutputLocation) {
      toast.error("Set an Athena results S3 path before running a query.");
      return;
    }

    try {
      const started = await startQuery.mutateAsync({
        sql,
        workgroup,
        outputLocation: effectiveOutputLocation,
        database: selectedDatabase
      });
      setQueryExecutionId(started.queryExecutionId);
      setResults(undefined);
      setResultsError(undefined);
      setBottomTab("results");
      setHistory(addSqlHistory(accountId, sql));
      toast.success("Athena query started.");
    } catch (error) {
      toast.error(formatAppError(error, "Failed to start Athena query."));
    }
  };

  const handleStopQuery = async () => {
    if (!queryExecutionId) return;
    try {
      await stopQuery.mutateAsync({ queryExecutionId });
      toast.success("Athena query cancelled.");
    } catch (error) {
      toast.error(formatAppError(error, "Failed to stop Athena query."));
    }
  };

  const handleExport = async () => {
    if (!queryExecutionId) return;
    try {
      const savedPath = await exportCsv.mutateAsync({
        queryExecutionId,
        suggestedName: "athena-query-results.csv"
      });
      if (savedPath) {
        toast.success(`Exported CSV to ${savedPath}`);
      }
    } catch (error) {
      toast.error(formatAppError(error, "Failed to export query results."));
    }
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
    setBottomTab("results");
    try {
      const started = await startQuery.mutateAsync({
        sql: dropSql,
        workgroup,
        outputLocation: effectiveOutputLocation,
        database: selectedDatabase
      });
      setQueryExecutionId(started.queryExecutionId);
      if (accountId) {
        setHistory(addSqlHistory(accountId, dropSql));
      }
      toast.success("Drop table query started.");
      handleRefreshCatalog();
    } catch (error) {
      toast.error(formatAppError(error, "Failed to drop table."));
    }
  };

  const loadFavorite = (entry: SqlFavoriteEntry) => setSql(entry.sql);
  const loadHistoryEntry = (entry: SqlHistoryEntry) => setSql(entry.sql);

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

  const running = execution.data?.state === "QUEUED" || execution.data?.state === "RUNNING";

  return (
    <div className="flex max-h-[calc(100dvh-10rem)] min-h-0 flex-col gap-4">
      <PageHeader
        pageId="glue"
        actions={
          selectedDatabase && selectedTable ? (
            <Button type="button" variant="destructive" size="sm" onClick={() => setDropDialogOpen(true)}>
              <Trash2 data-icon="inline-start" />
              Drop table
            </Button>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <section className="min-h-0 shrink-0" style={{ width: catalogPaneWidth }}>
          <CatalogTree
            selectedDatabase={selectedDatabase}
            selectedTable={selectedTable}
            onSelectTable={handleSelectTable}
            onRefresh={handleRefreshCatalog}
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

        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="athena-workgroup">Workgroup</Label>
                <WorkgroupSelect value={workgroup} onChange={setWorkgroup} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="athena-output-path">Results S3 path</Label>
                <Input
                  id="athena-output-path"
                  value={outputBasePath}
                  onChange={(event) => setOutputBasePath(event.target.value)}
                  placeholder="s3://bucket/athena-results/"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={appendSubmitUser} onCheckedChange={(checked) => setAppendSubmitUser(checked === true)} />
                Append submitUser ({submitUser})
              </label>
              <p className="text-xs text-muted-foreground">
                Effective path: <span className="font-mono">{effectiveOutputLocation || "—"}</span>
              </p>
            </div>

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
                <Button type="button" size="sm" disabled={startQuery.isPending || running} onClick={handleRunQuery}>
                  <Play data-icon="inline-start" />
                  Run
                </Button>
              </div>
            </div>

            <Textarea
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              rows={8}
              className="min-h-[160px] font-mono text-sm"
              spellCheck={false}
            />
          </div>

          <Tabs value={bottomTab} onValueChange={(value) => setBottomTab(value as "results" | "metadata")} className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="metadata">Table Metadata</TabsTrigger>
            </TabsList>
            <TabsContent value="results" className="min-h-0 flex-1 overflow-auto rounded-lg border p-3">
              <QueryResultsPanel
                execution={execution.data}
                results={results}
                loading={resultsLoading}
                error={resultsError}
                hasMore={Boolean(results?.nextToken)}
                onLoadMore={() => queryExecutionId && void loadResultsPage(queryExecutionId, results?.nextToken)}
                onExport={handleExport}
                exporting={exportCsv.isPending}
              />
            </TabsContent>
            <TabsContent value="metadata" className="min-h-0 flex-1 overflow-auto rounded-lg border p-3">
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

function WorkgroupSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const workgroups = useAthenaWorkgroups();
  const options = useMemo(() => {
    const names = new Set((workgroups.data ?? []).map((entry) => entry.name));
    names.add(value);
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [value, workgroups.data]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id="athena-workgroup">
        <SelectValue placeholder="Workgroup" />
      </SelectTrigger>
      <SelectContent>
        {workgroups.isLoading ? <SelectItem value={value}>{value}</SelectItem> : null}
        {options.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
