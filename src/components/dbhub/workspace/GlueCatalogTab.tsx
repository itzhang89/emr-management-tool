import { PanelLeftOpen } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CatalogTree } from "@/components/glue/CatalogTree";
import { AthenaQuerySettingsButton, AthenaQuerySettingsDialog, type AthenaQuerySettingsMode } from "@/components/glue/AthenaQuerySettingsDialog";
import { AthenaSqlEditor } from "@/components/glue/AthenaSqlEditor";
import { DatabaseMetadataPanel } from "@/components/glue/DatabaseMetadataPanel";
import { QueryResultTabsPanel } from "@/components/glue/QueryResultTabsPanel";
import { FavoriteNameDialog } from "@/components/glue/SqlQueryMenus";
import { TableMetadataPanel } from "@/components/glue/TableMetadataPanel";
import { QueryWorkspaceColumn } from "@/components/sql/QueryWorkspaceColumn";
import { nextQueryTitle, type QueryTabStripItem } from "@/components/sql/QueryTabsPanel";
import { SqlQueryToolbar } from "@/components/sql/SqlQueryToolbar";
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
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useAthenaQueryExecution,
  useExportAthenaQueryCsv,
  useStartAthenaQuery,
  useStopAthenaQuery,
  useAthenaWorkgroups
} from "@/hooks/useAthena";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import {
  useGlueDatabase,
  useGlueDatabases,
  useGlueTable,
  useGlueTables,
  useUpdateGlueDatabase,
  useUpdateGlueTable
} from "@/hooks/useGlue";
import { useSubmitUser } from "@/hooks/useJobConfigTemplates";
import { useT } from "@/i18n";
import { useAthenaAccountPreferences } from "@/hooks/useAthenaAccountPreferences";
import {
  displayAthenaResultsPath,
  isAthenaManagedResultsWorkgroup,
  isAthenaOutputPathRequired,
  resolveAthenaOutputLocation,
  resolveAthenaQueryOutputLocation
} from "@/services/athenaOutputPath";
import { isAthenaOutputPathError } from "@/services/athenaOutputPathErrors";
import { formatAppError } from "@/services/appErrorMessage";
import { athenaService } from "@/services/athenaService";
// Both workspaces cap their editors with the same number, so the ceiling is
// read from where it already lives rather than written a second time.
import { MAX_QUERY_TABS } from "@/services/dbWorkspaceCache";
import { glueService } from "@/services/glueService";
import { buildDropTableSql, buildSelectSql } from "@/services/glueSqlTemplates";
import {
  createLocationReminderKind,
  createStatementMissingLocation
} from "@/services/createLocationReminder";
import { validateSqlForRun } from "@/services/sqlLint";
import { getShortcutPrimaryKey, SHORTCUT_IDS } from "@/data/keyboardShortcuts";
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

/**
 * The Glue/Athena query workspace, moved verbatim out of the old
 * `GlueCatalogPage` when the page became the DBHub host. Renders as the
 * "Glue Catalog" fixed tab inside `DbHubPage`; behavior is unchanged.
 */

const WORKSPACE_PANE_MIN_WIDTH = 220;
const WORKSPACE_PANE_DEFAULT_WIDTH = 300;
const CATALOG_TOGGLE_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.GLUE_CATALOG_TOGGLE);
const RUN_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.GLUE_RUN_QUERY);
const RUN_NEW_TAB_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.GLUE_RUN_NEW_TAB);

const NEW_QUERY_TAB_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.DB_QUERY_TAB_NEW);

type MetadataKind = "table" | "database";

/**
 * One editor, with the result tabs that belong to it.
 *
 * Shaped like DBHub's `CachedQueryTab` minus everything Athena has no notion of
 * — no sort, no filter, no page offset — and held in component state rather than
 * in that workspace's cache: this workspace is not per-connection, and its
 * drafts have never outlived the session either.
 */
interface AthenaQueryTab {
  id: string;
  title: string;
  sql: string;
  resultTabs: QueryResultTab[];
  activeResultTabId?: string;
  /** The number the next result tab takes; see `buildResultTabTitle`. */
  nextResultIndex: number;
}

/**
 * The metadata pane rides in the editor strip as a tab of its own, but it is
 * not an editor: it holds no SQL, owns no results, and is deliberately not in
 * `queryTabs`. This id names it to the strip and to nothing else.
 */
const METADATA_TAB_ID = "glue-metadata";

function blankQueryTab(title: string, sql = "SELECT 1;"): AthenaQueryTab {
  return { id: crypto.randomUUID(), title, sql, resultTabs: [], nextResultIndex: 1 };
}

/**
 * The metadata pane dressed as a strip tab: an editor-shaped entry with nothing
 * in it, which is also why the column's `result()` refuses it and no run can
 * land in it.
 */
function metadataStripTab(title: string): AthenaQueryTab & QueryTabStripItem {
  return { id: METADATA_TAB_ID, title, sql: "", resultTabs: [], nextResultIndex: 1 };
}

export function GlueCatalogTab({ active = true }: { active?: boolean } = {}) {
  const t = useT();
  const queryClient = useQueryClient();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const submitUserQuery = useSubmitUser();
  const submitUser = submitUserQuery.data ?? "user";

  const [queryTabs, setQueryTabs] = useState<AthenaQueryTab[]>(() => [blankQueryTab("Query 1")]);
  const [activeQueryTabId, setActiveQueryTabId] = useState<string>();
  /**
   * Whether the metadata tab is in the strip at all. It is kept apart from the
   * selection because it is not a tab that can be left open in the background:
   * it is there because a table or a database was just asked about, and it is
   * gone the moment anything else is selected.
   */
  const [metadataTabOpen, setMetadataTabOpen] = useState(false);
  const [metadataKind, setMetadataKind] = useState<MetadataKind>("table");
  const [catalogViewDatabase, setCatalogViewDatabase] = useState<string | undefined>();
  const [selectedDatabase, setSelectedDatabase] = useState<string>();
  const [selectedTable, setSelectedTable] = useState<string>();
  const athenaPrefs = useAthenaAccountPreferences(accountId);
  const outputBasePath = athenaPrefs.outputBasePath;
  const appendSubmitUser = athenaPrefs.appendSubmitUser;
  const workgroup = athenaPrefs.workgroup;
  const catalogCollapsed = athenaPrefs.catalogCollapsed;
  const skipCreateLocationReminder = athenaPrefs.skipCreateLocationReminder;
  const [metadataEditMode, setMetadataEditMode] = useState(false);
  const [catalogPaneWidth, setCatalogPaneWidth] = useState(WORKSPACE_PANE_DEFAULT_WIDTH);
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<SqlFavoriteEntry[]>([]);
  const [dropDialogOpen, setDropDialogOpen] = useState(false);
  const [locationReminderOpen, setLocationReminderOpen] = useState(false);
  const [locationReminderDontAsk, setLocationReminderDontAsk] = useState(false);
  const [pendingLocationRun, setPendingLocationRun] = useState<
    { sql: string; mode: "active" | "new-tab"; queryTabId: string } | null
  >(null);
  const [favoriteDialogOpen, setFavoriteDialogOpen] = useState(false);
  const [pendingFavoriteEntry, setPendingFavoriteEntry] = useState<SqlHistoryEntry | null>(null);
  const [querySettingsOpen, setQuerySettingsOpen] = useState(false);
  const [querySettingsMode, setQuerySettingsMode] = useState<AthenaQuerySettingsMode>("normal");
  const [querySettingsHighlight, setQuerySettingsHighlight] = useState<"s3" | "workgroup" | undefined>();
  const [querySettingsError, setQuerySettingsError] = useState<string | undefined>();
  const loadedResultsRef = useRef<Set<string>>(new Set());
  const restoredCatalogAccountRef = useRef<string | undefined>(undefined);
  const shownOutputErrorRef = useRef<string | undefined>(undefined);

  /**
   * The editor in front. Falling back to the first one is what lets the
   * metadata tab be a plain flag rather than a sentinel id in the selection:
   * a sentinel would poison this lookup, and every writer that goes through it
   * would then edit the first editor while a different tab is on screen.
   */
  const activeQueryTab = useMemo(
    () => queryTabs.find((tab) => tab.id === activeQueryTabId) ?? queryTabs[0],
    [activeQueryTabId, queryTabs]
  );

  const activeResultTab = useMemo(() => {
    const tabs = activeQueryTab?.resultTabs ?? [];
    return tabs.find((tab) => tab.id === activeQueryTab?.activeResultTabId) ?? tabs[0];
  }, [activeQueryTab]);

  /** Write into one editor without disturbing its neighbours. */
  const patchQueryTab = useCallback((tabId: string, patch: Partial<AthenaQueryTab>) => {
    setQueryTabs((tabs) => tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  /** Where a template, a favourite or a table click lands: the editor in front. */
  const setEditorSql = useCallback(
    (next: string) => {
      if (!activeQueryTab) return;
      patchQueryTab(activeQueryTab.id, { sql: next });
    },
    [activeQueryTab, patchQueryTab]
  );

  /**
   * Patch one of an editor's result tabs. Takes a value or a function of the
   * current one, since a merged page needs to read what is already there.
   */
  const patchResultTab = useCallback(
    (
      queryTabId: string,
      resultTabId: string,
      patch: Partial<QueryResultTab> | ((tab: QueryResultTab) => Partial<QueryResultTab>)
    ) => {
      const resolve = typeof patch === "function" ? patch : () => patch;
      setQueryTabs((tabs) =>
        tabs.map((editor) =>
          editor.id === queryTabId
            ? {
                ...editor,
                resultTabs: editor.resultTabs.map((tab) =>
                  tab.id === resultTabId ? { ...tab, ...resolve(tab) } : tab
                )
              }
            : editor
        )
      );
    },
    []
  );

  /** Add a result tab to an editor, or replace the one already carrying its id. */
  const putResultTab = useCallback((queryTabId: string, tab: QueryResultTab) => {
    setQueryTabs((tabs) =>
      tabs.map((editor) => {
        if (editor.id !== queryTabId) return editor;
        const known = editor.resultTabs.some((entry) => entry.id === tab.id);
        return {
          ...editor,
          resultTabs: known
            ? editor.resultTabs.map((entry) => (entry.id === tab.id ? tab : entry))
            : [...editor.resultTabs, tab],
          activeResultTabId: tab.id,
          nextResultIndex: known ? editor.nextResultIndex : editor.nextResultIndex + 1
        };
      })
    );
  }, []);

  const tableDetail = useGlueTable(
    selectedDatabase && selectedTable && metadataKind === "table"
      ? { databaseName: selectedDatabase, tableName: selectedTable }
      : undefined
  );
  const databaseDetail = useGlueDatabase(
    selectedDatabase && metadataKind === "database" ? { databaseName: selectedDatabase } : undefined
  );
  const glueDatabases = useGlueDatabases();
  const glueTables = useGlueTables(selectedDatabase);
  const updateTable = useUpdateGlueTable();
  const updateDatabase = useUpdateGlueDatabase();
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

  const sqlCatalogContext = useMemo(
    () => ({
      databases: glueDatabases.data?.map((database) => database.name) ?? [],
      tables: glueTables.data?.map((table) => table.name) ?? [],
      selectedDatabase,
      resolveTables: async (database: string) => {
        if (!accountId || !database) return [];
        if (database === selectedDatabase && glueTables.data) {
          return glueTables.data.map((table) => table.name);
        }
        const tables = [];
        let nextToken: string | undefined;
        do {
          const page = await glueService.listTables({
            accountId,
            databaseName: database,
            nextToken,
            maxResults: 100
          });
          tables.push(...page.tables.map((table) => table.name));
          nextToken = page.nextToken;
        } while (nextToken);
        return tables;
      },
      resolveColumns: async (database: string, table: string) => {
        if (!accountId) return [];
        const detail = await glueService.getTable({
          accountId,
          databaseName: database,
          tableName: table
        });
        return detail.columns.map((column) => column.name);
      }
    }),
    [accountId, glueDatabases.data, glueTables.data, selectedDatabase]
  );

  const sqlExecutionError = useMemo(() => {
    if (activeResultTab?.execution?.state !== "FAILED") return undefined;
    return {
      message: activeResultTab.execution.stateChangeReason,
      sql: activeResultTab.sqlSnapshot
    };
  }, [
    activeResultTab?.execution?.state,
    activeResultTab?.execution?.stateChangeReason,
    activeResultTab?.sqlSnapshot
  ]);

  const assertSqlRunnable = useCallback(
    (sqlToRun: string) => {
      const validation = validateSqlForRun(sqlToRun, { selectedDatabase });
      if (!validation.ok) {
        toast.error(validation.messages[0] ?? "Fix SQL errors before running.");
        return false;
      }
      return true;
    },
    [selectedDatabase]
  );

  const openQuerySettings = useCallback(
    (options?: {
      mode?: AthenaQuerySettingsMode;
      highlight?: "s3" | "workgroup";
      errorMessage?: string;
    }) => {
      setQuerySettingsMode(options?.mode ?? "normal");
      setQuerySettingsHighlight(options?.highlight);
      setQuerySettingsError(options?.errorMessage);
      setQuerySettingsOpen(true);
    },
    []
  );

  const handleRefreshCatalog = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["glue-databases", accountId] });
    void queryClient.invalidateQueries({ queryKey: ["glue-tables", accountId] });
    void queryClient.invalidateQueries({ queryKey: ["glue-database", accountId] });
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
      shownOutputErrorRef.current = undefined;
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

  useEffect(() => {
    if (!accountId || !athenaPrefs.ready || !outputPathRequired) return;
    if (outputBasePath.trim() || displayResultsPath.trim()) return;
    if (athenaPrefs.preferences.querySettingsIntroSeen) return;

    athenaPrefs.updatePreferences({ querySettingsIntroSeen: true });
    openQuerySettings({ mode: "setup", highlight: "s3" });
  }, [
    accountId,
    athenaPrefs.preferences.querySettingsIntroSeen,
    athenaPrefs.ready,
    athenaPrefs.updatePreferences,
    displayResultsPath,
    openQuerySettings,
    outputBasePath,
    outputPathRequired
  ]);

  useEffect(() => {
    const reason = activeResultTab?.execution?.stateChangeReason;
    if (activeResultTab?.execution?.state !== "FAILED" || !reason) return;
    if (!isAthenaOutputPathError(reason)) return;
    if (shownOutputErrorRef.current === reason) return;

    shownOutputErrorRef.current = reason;
    openQuerySettings({ mode: "error", highlight: "s3", errorMessage: reason });
  }, [
    activeResultTab?.execution?.state,
    activeResultTab?.execution?.stateChangeReason,
    openQuerySettings
  ]);

  const loadResultsForTab = useCallback(
    async (queryTabId: string, tabId: string, executionId: string, nextToken?: string) => {
      patchResultTab(queryTabId, tabId, { resultsLoading: true, resultsError: undefined });
      try {
        const page = await athenaService.getQueryResults({
          accountId,
          queryExecutionId: executionId,
          nextToken,
          maxResults: 1000
        });
        patchResultTab(queryTabId, tabId, (tab) => ({
          results: mergeResultPages(tab.results, page, Boolean(nextToken)),
          resultsLoading: false
        }));
      } catch (error) {
        patchResultTab(queryTabId, tabId, { resultsLoading: false, resultsError: error });
      }
    },
    [accountId, patchResultTab]
  );

  // Both of these depend on the *ids* of what is on screen and not on the tabs
  // themselves: a patch produces new tab objects, and an effect that watched
  // them would re-run on its own write.
  useEffect(() => {
    if (!activeQueryTab?.id || !activeResultTab?.id || !execution.data) return;
    patchResultTab(activeQueryTab.id, activeResultTab.id, { execution: execution.data });
  }, [activeQueryTab?.id, activeResultTab?.id, execution.data, patchResultTab]);

  useEffect(() => {
    if (!activeQueryTab?.id || !activeResultTab?.id || execution.data?.state !== "SUCCEEDED") return;
    const executionId = activeResultTab.queryExecutionId;
    if (!executionId) return;
    if (loadedResultsRef.current.has(executionId)) return;
    loadedResultsRef.current.add(executionId);
    void loadResultsForTab(activeQueryTab.id, activeResultTab.id, executionId);
    if (isCatalogMutatingSql(activeResultTab.sqlSnapshot)) {
      handleRefreshCatalog();
    }
  }, [
    activeQueryTab?.id,
    activeResultTab?.id,
    activeResultTab?.queryExecutionId,
    activeResultTab?.sqlSnapshot,
    execution.data?.state,
    loadResultsForTab,
    handleRefreshCatalog
  ]);

  useEffect(() => {
    setMetadataEditMode(false);
  }, [selectedDatabase, selectedTable, metadataKind]);

  const handleSelectTable = (databaseName: string, tableName: string) => {
    setCatalogViewDatabase(databaseName);
    setSelectedDatabase(databaseName);
    setSelectedTable(tableName);
    setMetadataKind("table");
    setMetadataEditMode(false);
    athenaPrefs.setLastDatabase(databaseName);
    // Clicking a table means "write me a query for this", so it lands in the
    // editor it was clicked from — unless the metadata pane is the tab in
    // front, where there is no editor on screen to write into and the click
    // only re-points the pane.
    if (!metadataTabOpen) {
      setEditorSql(buildSelectSql(databaseName, tableName));
    }
  };

  const handleFocusDatabase = (databaseName: string) => {
    setCatalogViewDatabase(databaseName);
    setSelectedDatabase(databaseName);
    setSelectedTable(undefined);
    athenaPrefs.setLastDatabase(databaseName);
  };

  const handleShowDatabaseMetadata = (databaseName: string) => {
    setSelectedDatabase(databaseName);
    setSelectedTable(undefined);
    setMetadataKind("database");
    setMetadataEditMode(false);
    setMetadataTabOpen(true);
    athenaPrefs.setLastDatabase(databaseName);
  };

  const handleShowTableMetadata = (databaseName: string, tableName: string) => {
    setCatalogViewDatabase(databaseName);
    setSelectedDatabase(databaseName);
    setSelectedTable(tableName);
    setMetadataKind("table");
    setMetadataEditMode(false);
    setMetadataTabOpen(true);
    athenaPrefs.setLastDatabase(databaseName);
  };

  const handleExitDatabase = () => {
    setCatalogViewDatabase(undefined);
    setSelectedDatabase(undefined);
    setSelectedTable(undefined);
  };

  /** The id the strip highlights, and the one the close/cycle chords act on. */
  const activeTabId = metadataTabOpen ? METADATA_TAB_ID : (activeQueryTab?.id ?? "");

  const stripTabs: Array<AthenaQueryTab & QueryTabStripItem> = [
    ...queryTabs.map((tab) => ({
      ...tab,
      // With a single editor open there is nothing to fall back to, so the last
      // one is pinned. The strip's own "hide the × when there is one tab" rule
      // cannot say this once a metadata tab is in the strip beside it: that is
      // a second tab, but not a second editor.
      closable: queryTabs.length > 1
    })),
    ...(metadataTabOpen
      ? [metadataStripTab(t(metadataKind === "database" ? "Database Metadata" : "Table Metadata"))]
      : [])
  ];

  /**
   * The one way a tab gets selected. Every path goes through here — the strip,
   * the `+`, ⌘N, the cycle chords — which is what makes the metadata tab's rule
   * hold: it is on screen because a table or a database was just asked about,
   * and moving to any other tab is moving away from that.
   */
  const selectTab = (tabId: string) => {
    if (tabId === METADATA_TAB_ID) {
      setMetadataTabOpen(true);
      return;
    }
    setMetadataTabOpen(false);
    setActiveQueryTabId(tabId);
  };

  const openQueryTab = () => {
    if (queryTabs.length >= MAX_QUERY_TABS) {
      toast.error(
        t("Close a query tab first — {used} of {max} are open.", {
          used: queryTabs.length,
          max: MAX_QUERY_TABS
        })
      );
      return;
    }
    const fresh = blankQueryTab(nextQueryTitle(queryTabs));
    setMetadataTabOpen(false);
    setQueryTabs((tabs) => [...tabs, fresh]);
    setActiveQueryTabId(fresh.id);
  };

  const closeQueryTab = (tabId: string) => {
    if (tabId === METADATA_TAB_ID) {
      setMetadataTabOpen(false);
      return;
    }
    if (queryTabs.length <= 1) return;
    const kept = queryTabs.filter((tab) => tab.id !== tabId);
    setQueryTabs(kept);
    if (tabId === activeQueryTab?.id) {
      setActiveQueryTabId(kept[kept.length - 1]?.id);
    }
  };

  const cycleQueryTabs = (delta: 1 | -1) => {
    const ids = [...queryTabs.map((tab) => tab.id), ...(metadataTabOpen ? [METADATA_TAB_ID] : [])];
    if (ids.length < 2) return;
    const current = metadataTabOpen ? METADATA_TAB_ID : activeQueryTab?.id;
    const index = Math.max(ids.indexOf(current ?? ""), 0);
    const next = ids[(index + delta + ids.length) % ids.length];
    // Through `selectTab`, not around it: stepping off the metadata tab with
    // the keyboard has to close it exactly as clicking away does.
    if (next) selectTab(next);
  };

  /**
   * Start a statement and put it in one of an editor's result tabs: the tab
   * already in front for a plain run, a fresh one for "run in new tab". The
   * editor is named rather than assumed, because by the time the server answers
   * the user may be looking at a different one — and the result belongs to the
   * editor the statement came from, not to whatever is on screen.
   */
  const runInEditor = async (queryTabId: string, sqlToRun: string, mode: "active" | "new-tab") => {
    if (!accountId) return;
    if (selectedWorkgroup?.sparkEnabled) {
      toast.error(
        "The selected workgroup is Spark-enabled. Choose an Athena SQL workgroup to run queries here."
      );
      return;
    }
    if (outputPathRequired) {
      toast.error("Configure an S3 query results path before running Athena queries.");
      openQuerySettings({ mode: "setup", highlight: "s3" });
      return;
    }

    const editor = queryTabs.find((tab) => tab.id === queryTabId);
    if (!editor) return;

    // A rerun writes over the tab in front of that editor. Keeping its name is
    // deliberate: the name was the table the tab was opened for, and a rerun of
    // the same query should not rename it — nor should an edited one quietly
    // relearn it while the user watches.
    const reuse =
      mode === "new-tab"
        ? undefined
        : editor.resultTabs.find((tab) => tab.id === editor.activeResultTabId);
    const resultTab: QueryResultTab = reuse ?? {
      ...createQueryResultTab(editor.nextResultIndex),
      title: buildResultTabTitle(sqlToRun, editor.nextResultIndex)
    };

    putResultTab(queryTabId, {
      ...resultTab,
      sqlSnapshot: sqlToRun,
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
      patchResultTab(queryTabId, resultTab.id, {
        queryExecutionId: started.queryExecutionId,
        execution: started
      });
      setHistory(addSqlHistory(accountId, sqlToRun));
      toast.success(t("Athena query started."));
    } catch (error) {
      const message = formatAppError(error, "Failed to start Athena query.");
      if (isAthenaOutputPathError(message)) {
        openQuerySettings({ mode: "error", highlight: "s3", errorMessage: message });
      }
      toast.error(message);
    }
  };

  const beginQueryRun = (sqlToRun: string, mode: "active" | "new-tab") => {
    if (!activeQueryTab) return;
    if (!assertSqlRunnable(sqlToRun)) return;
    const queryTabId = activeQueryTab.id;
    if (!skipCreateLocationReminder && createStatementMissingLocation(sqlToRun)) {
      // The reminder outlives the click that raised it, so the editor it was
      // raised from travels with it.
      setPendingLocationRun({ sql: sqlToRun, mode, queryTabId });
      setLocationReminderDontAsk(false);
      setLocationReminderOpen(true);
      return;
    }
    void runInEditor(queryTabId, sqlToRun, mode);
  };

  const handleRunQuery = (sqlOverride?: string) => {
    beginQueryRun(sqlOverride ?? activeQueryTab?.sql ?? "", "active");
  };

  const handleRunQueryInNewTab = (sqlOverride?: string) => {
    beginQueryRun(sqlOverride ?? activeQueryTab?.sql ?? "", "new-tab");
  };

  const confirmLocationReminder = () => {
    if (locationReminderDontAsk) {
      athenaPrefs.setSkipCreateLocationReminder(true);
    }
    const pending = pendingLocationRun;
    setLocationReminderOpen(false);
    setPendingLocationRun(null);
    if (!pending) return;
    void runInEditor(pending.queryTabId, pending.sql, pending.mode);
  };

  const handleStopQuery = async () => {
    const executionId = activeResultTab?.queryExecutionId;
    if (!executionId) return;
    try {
      await stopQuery.mutateAsync({ queryExecutionId: executionId });
      toast.success(t("Athena query cancelled."));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to stop Athena query."));
    }
  };

  const handleExport = async (queryTabId: string, tabId: string) => {
    const tab = queryTabs
      .find((editor) => editor.id === queryTabId)
      ?.resultTabs.find((entry) => entry.id === tabId);
    if (!tab?.queryExecutionId) return;
    try {
      const savedPath = await exportCsv.mutateAsync({
        queryExecutionId: tab.queryExecutionId,
        suggestedName: "athena-query-results.csv"
      });
      if (savedPath) {
        toast.success(t("Exported CSV to {path}", { path: savedPath }));
      }
    } catch (error) {
      toast.error(formatAppError(error, "Failed to export query results."));
    }
  };

  /**
   * An editor's last result tab is not closable — the strip hides its × then,
   * too. It used to close into a fresh blank tab instead, which meant the ×
   * did two different things and that the run it was pressed on could still be
   * on screen afterwards, unnamed and empty.
   */
  const closeResultTab = (queryTabId: string, tabId: string) => {
    setQueryTabs((tabs) =>
      tabs.map((editor) => {
        if (editor.id !== queryTabId || editor.resultTabs.length <= 1) return editor;
        const kept = editor.resultTabs.filter((tab) => tab.id !== tabId);
        return {
          ...editor,
          resultTabs: kept,
          activeResultTabId:
            editor.activeResultTabId === tabId ? kept[0]?.id : editor.activeResultTabId
        };
      })
    );
  };

  const cycleResultTab = (queryTabId: string, delta: number) => {
    setQueryTabs((tabs) =>
      tabs.map((editor) => {
        if (editor.id !== queryTabId || editor.resultTabs.length <= 1) return editor;
        const index = editor.resultTabs.findIndex((tab) => tab.id === editor.activeResultTabId);
        const next =
          editor.resultTabs[
            (Math.max(index, 0) + delta + editor.resultTabs.length) % editor.resultTabs.length
          ];
        return next ? { ...editor, activeResultTabId: next.id } : editor;
      })
    );
  };

  const handleSaveMetadata = async (table: NonNullable<typeof tableDetail.data>) => {
    try {
      await updateTable.mutateAsync({ table });
      setMetadataEditMode(false);
      toast.success(t("Table metadata updated."));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to update table metadata."));
    }
  };

  const handleSaveDatabaseMetadata = async (database: NonNullable<typeof databaseDetail.data>) => {
    try {
      await updateDatabase.mutateAsync({ database });
      setMetadataEditMode(false);
      toast.success(t("Database metadata updated."));
    } catch (error) {
      toast.error(formatAppError(error, "Failed to update database metadata."));
    }
  };

  const handleDropTable = async () => {
    if (!selectedDatabase || !selectedTable || !activeQueryTab) return;
    const dropSql = buildDropTableSql(selectedDatabase, selectedTable);
    const queryTabId = activeQueryTab.id;
    setDropDialogOpen(false);
    setMetadataTabOpen(false);
    patchQueryTab(queryTabId, { sql: dropSql });
    setSelectedTable(undefined);
    handleRefreshCatalog();
    await runInEditor(queryTabId, dropSql, "active");
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

  const beginFavoriteFromHistory = (entry: SqlHistoryEntry) => {
    if (!accountId) return;
    setPendingFavoriteEntry(entry);
    setFavoriteDialogOpen(true);
  };

  const confirmFavoriteFromHistory = (name: string) => {
    if (!accountId || !pendingFavoriteEntry) return;
    setFavorites(addSqlFavorite(accountId, name, pendingFavoriteEntry.sql));
    setPendingFavoriteEntry(null);
    toast.success(t("SQL saved to favorites."));
  };

  const favoriteSqlSet = useMemo(
    () => new Set(favorites.map((entry) => entry.sql.trim())),
    [favorites]
  );

  const running =
    activeResultTab?.execution?.state === "QUEUED" || activeResultTab?.execution?.state === "RUNNING";

  useEffect(() => {
    // Only the workspace on screen answers its shortcuts. This tab stays
    // mounted once opened (`PersistMount`), so an ungated listener fires from
    // every other sub-tab too — and would toggle a second workspace's catalog
    // alongside its own.
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key === "\\") {
        event.preventDefault();
        athenaPrefs.setCatalogCollapsed(!catalogCollapsed);
        return;
      }

      if (!mod) return;

      if (!activeQueryTab?.id) return;

      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        cycleResultTab(activeQueryTab.id, 1);
        return;
      }

      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        cycleResultTab(activeQueryTab.id, -1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    // `h-full`, not `calc(100vh-3rem)`: this is a tab inside `DbHubPage`,
    // which has already measured the viewport and taken the tab strip and the
    // page's gaps out of it. Asking for the viewport again made the workspace
    // taller than its box, so the ancestors' `overflow-hidden` clipped the
    // bottom of it — with nothing left to scroll, the last rows simply were
    // not there.
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">

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
                  onClick={() => athenaPrefs.setCatalogCollapsed(false)}
                >
                  <PanelLeftOpen className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("Show catalog")} · {CATALOG_TOGGLE_SHORTCUT}</TooltipContent>
            </Tooltip>
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
                onShowDatabaseMetadata={handleShowDatabaseMetadata}
                onShowTableMetadata={handleShowTableMetadata}
                onRefresh={handleRefreshCatalog}
                onCollapse={() => athenaPrefs.setCatalogCollapsed(true)}
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

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {activeQueryTab ? (
            <QueryWorkspaceColumn
              active={active}
              tabs={stripTabs}
              activeTabId={activeTabId}
              onSelectTab={selectTab}
              onCloseTab={closeQueryTab}
              onNewTab={openQueryTab}
              newTabShortcut={NEW_QUERY_TAB_SHORTCUT}
              onCycleTabs={cycleQueryTabs}
              onCloseActiveTab={() => closeQueryTab(activeTabId)}
              /*
               * No toolbar over the metadata pane: it holds no SQL, so every
               * button on that row would be pointed at an editor that is not
               * on screen.
               */
              header={(tab) =>
                tab.id === METADATA_TAB_ID ? null : (
                  <div className="flex shrink-0 items-center gap-1">
                    <SqlQueryToolbar
                      history={history}
                      favoriteSqlSet={favoriteSqlSet}
                      favorites={favorites}
                      onSelectSql={setEditorSql}
                      onFavorite={beginFavoriteFromHistory}
                      onRemoveFavorite={(favoriteId) => {
                        if (accountId) setFavorites(removeSqlFavorite(accountId, favoriteId));
                      }}
                      running={running}
                      runPending={startQuery.isPending}
                      onStop={() => void handleStopQuery()}
                      onRunNewTab={() => handleRunQueryInNewTab()}
                      onRun={() => handleRunQuery()}
                      runNewTabHint={RUN_NEW_TAB_SHORTCUT}
                      runHint={RUN_SHORTCUT}
                    />
                    <div className="ml-auto">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <AthenaQuerySettingsButton
                              setupRequired={outputPathRequired}
                              onClick={() => openQuerySettings()}
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {outputPathRequired
                            ? `${t("Query settings")} · ${t("S3 path required")}`
                            : t("Query settings")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                )
              }
              editor={(tab) =>
                tab.id === METADATA_TAB_ID ? (
                  <div className="h-full min-h-0 overflow-auto rounded-lg border p-3">
                    {metadataKind === "database" ? (
                      <DatabaseMetadataPanel
                        database={databaseDetail.data}
                        loading={databaseDetail.isLoading}
                        error={databaseDetail.error}
                        editMode={metadataEditMode}
                        onEditModeChange={setMetadataEditMode}
                        onSave={handleSaveDatabaseMetadata}
                        saving={updateDatabase.isPending}
                      />
                    ) : (
                      <TableMetadataPanel
                        table={tableDetail.data}
                        loading={tableDetail.isLoading}
                        error={tableDetail.error}
                        editMode={metadataEditMode}
                        onEditModeChange={setMetadataEditMode}
                        onSave={handleSaveMetadata}
                        saving={updateTable.isPending}
                      />
                    )}
                  </div>
                ) : (
                  /* Keyed by editor: each tab is its own CodeMirror document, so
                     undo in one never reaches into another's text. */
                  <AthenaSqlEditor
                    key={tab.id}
                    className="h-full"
                    value={tab.sql}
                    onChange={(next) => patchQueryTab(tab.id, { sql: next })}
                    onRun={handleRunQuery}
                    onRunNewTab={handleRunQueryInNewTab}
                    selectedDatabase={selectedDatabase}
                    catalogContext={sqlCatalogContext}
                    executionError={sqlExecutionError}
                  />
                )
              }
              /* Null for the metadata tab: it has no results, so it takes the
                 whole column — no result strip and no splitter. */
              result={(tab) =>
                tab.id === METADATA_TAB_ID
                  ? null
                  : {
                      onCycle: (delta) => cycleResultTab(tab.id, delta),
                      onCloseActive: () => {
                        if (tab.resultTabs.length <= 1) return;
                        if (!tab.activeResultTabId) return;
                        closeResultTab(tab.id, tab.activeResultTabId);
                      },
                      node: (
                        <QueryResultTabsPanel
                          tabs={tab.resultTabs}
                          activeTabId={tab.activeResultTabId ?? ""}
                          onSelectTab={(resultTabId) =>
                            patchQueryTab(tab.id, { activeResultTabId: resultTabId })
                          }
                          onCloseTab={(resultTabId) => closeResultTab(tab.id, resultTabId)}
                          onLoadMore={(resultTabId) => {
                            const entry = tab.resultTabs.find((item) => item.id === resultTabId);
                            if (entry?.queryExecutionId) {
                              void loadResultsForTab(
                                tab.id,
                                resultTabId,
                                entry.queryExecutionId,
                                entry.results?.nextToken
                              );
                            }
                          }}
                          onExport={(resultTabId) => void handleExport(tab.id, resultTabId)}
                          exporting={exportCsv.isPending}
                          emptyLabel={t("Run a query to see results here.")}
                        />
                      )
                    }
              }
            />
          ) : null}
        </section>
      </div>

      <AthenaQuerySettingsDialog
        open={querySettingsOpen}
        onOpenChange={setQuerySettingsOpen}
        mode={querySettingsMode}
        highlightSection={querySettingsHighlight}
        errorMessage={querySettingsError}
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

      <FavoriteNameDialog
        open={favoriteDialogOpen}
        onOpenChange={(open) => {
          setFavoriteDialogOpen(open);
          if (!open) setPendingFavoriteEntry(null);
        }}
        onConfirm={confirmFavoriteFromHistory}
      />

      <Dialog open={dropDialogOpen} onOpenChange={setDropDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Drop table?")}</DialogTitle>
            <DialogDescription>
              {t("This runs `DROP TABLE IF EXISTS {database}.{table}` in Athena and cannot be undone.", {
                database: selectedDatabase ?? "",
                table: selectedTable ?? ""
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDropDialogOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={handleDropTable}>
              {t("Drop table")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={locationReminderOpen}
        onOpenChange={(open) => {
          setLocationReminderOpen(open);
          if (!open) setPendingLocationRun(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Missing LOCATION clause")}</DialogTitle>
            <DialogDescription>
              {t(
                createLocationReminderKind(pendingLocationRun?.sql ?? "") === "database"
                  ? "This CREATE DATABASE statement does not include LOCATION. Athena allows it, but databases without an S3 location can be harder to manage later."
                  : "This CREATE TABLE statement does not include LOCATION. Athena allows it for some cases, but external tables usually need an S3 path."
              )}{" "}
              {t("Continue anyway?")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Checkbox
              id="skip-location-reminder"
              checked={locationReminderDontAsk}
              onCheckedChange={(checked) => setLocationReminderDontAsk(checked === true)}
            />
            <Label htmlFor="skip-location-reminder" className="text-sm font-normal">
              {t("Don't remind me again for this account")}
            </Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLocationReminderOpen(false);
                setPendingLocationRun(null);
              }}
            >
              {t("Cancel")}
            </Button>
            <Button type="button" onClick={confirmLocationReminder}>
              {t("Continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
