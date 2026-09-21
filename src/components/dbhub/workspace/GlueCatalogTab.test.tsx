import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlueCatalogTab } from "./GlueCatalogTab";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AthenaQueryExecution } from "@/types/domain";

/**
 * The Glue workspace's own behaviour: editors that hold their SQL and their
 * results separately, and a metadata pane that is a tab only while it is being
 * looked at.
 *
 * The parts it shares with the JDBC workspace — the strip, the splitter, the
 * chords — are exercised in `ConnectionQueryTab.test.tsx`, which is where the
 * shared components were made to earn their keep. What is checked here is what
 * Glue does with them, so the AWS plumbing is mocked away rather than played.
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock("@/hooks/useAwsSettings", () => ({
  useActiveAwsAccount: () => ({ data: { id: "acct-a", name: "Test", region: "us-east-1" } })
}));

vi.mock("@/hooks/useJobConfigTemplates", () => ({
  useSubmitUser: () => ({ data: "tester" })
}));

const setLastDatabase = vi.fn();
vi.mock("@/hooks/useAthenaAccountPreferences", () => ({
  useAthenaAccountPreferences: () => ({
    ready: true,
    preferences: {},
    // A configured results path, so the query-settings dialog stays shut and a
    // run is allowed to be a run.
    outputBasePath: "s3://example-results/athena",
    appendSubmitUser: true,
    workgroup: "primary",
    catalogCollapsed: false,
    // The LOCATION reminder is its own dialog with its own tests upstream; here
    // it would sit between the click and the run being asserted.
    skipCreateLocationReminder: true,
    lastDatabase: undefined,
    updatePreferences: vi.fn(),
    setOutputBasePath: vi.fn(),
    setAppendSubmitUser: vi.fn(),
    setWorkgroup: vi.fn(),
    setCatalogCollapsed: vi.fn(),
    setLastDatabase,
    setSkipCreateLocationReminder: vi.fn()
  })
}));

const startQuery = vi.fn();
const stopQuery = vi.fn();
const exportCsv = vi.fn();
/**
 * The execution the workspace is polling, per query-execution id.
 *
 * Left undefined by default so an editor that has run nothing stays that way;
 * a test that wants results gives the id an execution, which is also what lets
 * the results-loading effect fire at all — it waits for `SUCCEEDED`.
 */
const executionById = new Map<string, AthenaQueryExecution>();
vi.mock("@/hooks/useAthena", () => ({
  useStartAthenaQuery: () => ({ mutateAsync: startQuery, isPending: false }),
  useStopAthenaQuery: () => ({ mutateAsync: stopQuery, isPending: false }),
  useExportAthenaQueryCsv: () => ({ mutateAsync: exportCsv, isPending: false }),
  useAthenaWorkgroups: () => ({
    data: [{ name: "primary", outputLocation: "s3://example-results/athena" }],
    isLoading: false
  }),
  useAthenaQueryExecution: (queryExecutionId?: string) => ({
    data: queryExecutionId ? executionById.get(queryExecutionId) : undefined
  })
}));

vi.mock("@/hooks/useGlue", () => ({
  useGlueDatabases: () => ({
    data: [{ name: "default" }],
    isLoading: false,
    isFetching: false,
    error: undefined
  }),
  useGlueTables: () => ({
    data: [{ name: "orders" }, { name: "customers" }],
    isLoading: false,
    error: undefined
  }),
  useGlueDatabase: () => ({ data: undefined, isLoading: false, error: undefined }),
  useGlueTable: () => ({ data: undefined, isLoading: false, error: undefined }),
  useUpdateGlueTable: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateGlueDatabase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  cloneGlueTableDetail: (value: unknown) => value
}));

const getQueryResults = vi.fn();
vi.mock("@/services/athenaService", () => ({
  athenaService: { getQueryResults: (...args: unknown[]) => getQueryResults(...args) }
}));

vi.mock("@/services/glueService", () => ({
  glueService: {
    listTables: vi.fn().mockResolvedValue({ tables: [], nextToken: undefined }),
    getTable: vi.fn().mockResolvedValue({ columns: [] })
  }
}));

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GlueCatalogTab active />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** The catalog's list level, which is where every test starts. */
async function openCatalog() {
  return screen.findByRole("button", { name: "default" });
}

/** The strip entry for an editor, whose `title` is the SQL it holds. */
function editorTab(title: string) {
  const tab = screen.getByRole("button", { name: title });
  return tab.getAttribute("title") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` drops calls but keeps implementations, so anything a test
  // relies on being unset has to be unset here rather than left to the default.
  executionById.clear();
  getQueryResults.mockReset();
  // A finished run, not one in flight: the strip marks a running tab with a
  // "● " in front of its name, which is not what these names are about.
  startQuery.mockResolvedValue({ queryExecutionId: "exec-1", state: "SUCCEEDED" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** A finished run whose results are ready to be fetched. */
function givenAFailedExecution(reason: string) {
  executionById.set("exec-1", {
    queryExecutionId: "exec-1",
    state: "FAILED",
    stateChangeReason: reason
  } as AthenaQueryExecution);
}

function givenASucceededExecution(overrides: Partial<AthenaQueryExecution> = {}) {
  executionById.set("exec-1", {
    queryExecutionId: "exec-1",
    state: "SUCCEEDED",
    dataScannedBytes: 2048,
    engineExecutionTimeMs: 1500,
    completionDateTime: "2026-09-20T10:00:00Z",
    ...overrides
  } as AthenaQueryExecution);
}

describe("GlueCatalogTab editors", () => {
  it("opens a second editor on ⌘N, and it starts with no results of its own", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCatalog();

    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();

    await user.keyboard("{Meta>}n{/Meta}");
    expect(await screen.findByRole("button", { name: "Query 2" })).toBeInTheDocument();

    // The second editor has run nothing, so the first editor's result is not
    // beneath it — that is the whole point of the result tabs being its own.
    expect(screen.queryByRole("button", { name: "Result 1" })).not.toBeInTheDocument();
    expect(screen.getByText("Run a query to see results here.")).toBeInTheDocument();

    // ⌘⇧[ walks the editor strip, so it comes back to the editor that ran.
    await user.keyboard("{Meta>}{Shift>}{[}{/Shift}{/Meta}");
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();
  });

  it("writes a table click into the editor in front, not into the one that ran last", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await openCatalog());
    await user.click(await screen.findByRole("button", { name: "orders" }));

    expect(editorTab("Query 1")).toContain("orders");

    await user.keyboard("{Meta>}n{/Meta}");
    await screen.findByRole("button", { name: "Query 2" });
    await user.click(screen.getByRole("button", { name: "customers" }));

    expect(editorTab("Query 2")).toContain("customers");
    // The first editor kept the statement it was given.
    expect(editorTab("Query 1")).toContain("orders");
  });

  it("gives each editor its own result tabs", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCatalog();

    // Two runs in one editor share its tab rather than piling up beside it.
    await user.click(screen.getByRole("button", { name: "Run query" }));
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run query" }));
    expect(screen.getAllByRole("button", { name: /^Result \d+$/ })).toHaveLength(1);

    // A second copy of the same statement, beside the first rather than over
    // it: what "run in new tab" is for.
    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    expect(await screen.findByRole("button", { name: "Result 2" })).toBeInTheDocument();

    await user.keyboard("{Meta>}n{/Meta}");
    await screen.findByRole("button", { name: "Query 2" });
    expect(screen.queryByRole("button", { name: /^Result \d+$/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run query" }));
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();

    // Back to the first editor: its two tabs are where it left them.
    await user.keyboard("{Meta>}{Shift>}{[}{/Shift}{/Meta}");
    expect(await screen.findByRole("button", { name: "Result 2" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Result \d+$/ })).toHaveLength(2);

    // And the second editor still has only the one it ran.
    await user.keyboard("{Meta>}{Shift>}]{/Shift}{/Meta}");
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Result 2" })).not.toBeInTheDocument();
  });

  it("closes the editor in front on ⌘W, and refuses the last one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCatalog();

    await user.keyboard("{Meta>}n{/Meta}");
    await screen.findByRole("button", { name: "Query 2" });

    await user.keyboard("{Meta>}w{/Meta}");
    expect(screen.queryByRole("button", { name: "Query 2" })).not.toBeInTheDocument();

    // The last editor is not replaced by a blank one — ⌘W simply does nothing
    // rather than taking the statement with it.
    await user.keyboard("{Meta>}w{/Meta}");
    expect(screen.getByRole("button", { name: "Query 1" })).toBeInTheDocument();
  });
});

describe("GlueCatalogTab metadata tab", () => {
  it("appears when a database is asked about, and is gone on the next tab", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCatalog();

    await user.click(screen.getByRole("button", { name: "Show details for default" }));

    expect(await screen.findByRole("button", { name: "Database Metadata" })).toBeInTheDocument();
    // It is not an editor, so the SQL toolbar is not over it.
    expect(screen.queryByRole("button", { name: "Run query" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Query 1" }));

    expect(screen.queryByRole("button", { name: "Database Metadata" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run query" })).toBeInTheDocument();
  });

  it("names itself after the table whose details were asked for", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await openCatalog());
    await screen.findByRole("button", { name: "orders" });

    await user.click(screen.getByRole("button", { name: "Show details for orders" }));

    expect(await screen.findByRole("button", { name: "Table Metadata" })).toBeInTheDocument();
  });

  it("pins the lone editor open while the metadata tab beside it is closable", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCatalog();

    await user.click(screen.getByRole("button", { name: "Show details for default" }));
    await screen.findByRole("button", { name: "Database Metadata" });

    // Two tabs, but one editor: closing it would leave the pane with nothing
    // to fall back to, so its × is not offered even though the strip is no
    // longer a single tab.
    expect(screen.queryByRole("button", { name: "Close Query 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Database Metadata" })).toBeInTheDocument();
  });

  it("closes on ⌘W like any other tab", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCatalog();

    await user.click(screen.getByRole("button", { name: "Show details for default" }));
    await screen.findByRole("button", { name: "Database Metadata" });

    await user.keyboard("{Meta>}w{/Meta}");

    expect(screen.queryByRole("button", { name: "Database Metadata" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Query 1" })).toBeInTheDocument();
  });
});

describe("GlueCatalogTab split", () => {
  it("resizes the editor against the results, and the metadata tab has no splitter", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCatalog();

    const handle = screen.getByRole("separator", { name: "Resize the editor and result areas" });
    expect(handle).toHaveAttribute("aria-valuenow", "220");

    fireEvent.mouseDown(handle, { clientY: 100 });
    fireEvent.mouseMove(document, { clientY: 180 });
    fireEvent.mouseUp(document);

    expect(handle).toHaveAttribute("aria-valuenow", "300");

    await user.click(screen.getByRole("button", { name: "Show details for default" }));

    // Two halves are the editor's and the results'; the metadata pane is only
    // one, so there is nothing to drag between.
    expect(
      screen.queryByRole("separator", { name: "Resize the editor and result areas" })
    ).not.toBeInTheDocument();
  });
});

/**
 * The result area, which Athena now shares with the JDBC workspace: the same
 * grid, the same rail, the same strip. What is checked here is the part that is
 * Athena's own — that its rows reach a `Record<string, unknown>` grid with the
 * header taken off, that the strip offers a cursor rather than a pager, and
 * that a run that failed says so instead of drawing a table.
 */
describe("GlueCatalogTab results", () => {
  /** Run the default statement and wait for its result tab to be drawn. */
  async function runAndShowResults(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Run query" }));
    return screen.findByRole("button", { name: "Result 1" });
  }

  /** The text of each drawn data cell, in the order the grid draws them. */
  function drawnColumns(): string[] {
    return screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]?.textContent ?? "");
  }

  it("draws the rows under their column names, with the header row taken off", async () => {
    const user = userEvent.setup();
    givenASucceededExecution();
    // Athena repeats the column names in the first row of every page, so a page
    // arrives with one row more than it has data.
    getQueryResults.mockResolvedValue({
      columnNames: ["id", "name"],
      rows: [
        ["id", "name"],
        ["1", "ada"],
        ["2", "grace"]
      ]
    });
    renderWorkspace();
    await openCatalog();
    await runAndShowResults(user);

    expect(await screen.findByText("ada")).toBeInTheDocument();
    expect(screen.getByText("grace")).toBeInTheDocument();
    // A header left in would have drawn as a fourth row, and as a second "id"
    // cell beside the column heading of the same name.
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getAllByText("id")).toHaveLength(1);
    expect(screen.getAllByText("name")).toHaveLength(1);
  });

  it("offers the three formats, and switching to Text redraws as text", async () => {
    const user = userEvent.setup();
    givenASucceededExecution();
    getQueryResults.mockResolvedValue({
      columnNames: ["name"],
      rows: [["name"], ["ada"]]
    });
    renderWorkspace();
    await openCatalog();
    await runAndShowResults(user);
    await screen.findByText("ada");

    // The rail's tabs are words set sideways, so they are found by `title`.
    await user.click(screen.getByTitle("Text"));

    // The text view is a dump rather than a layout: the column names head a
    // tab-separated body, and the table's own headings went with the grid.
    expect(await screen.findByText(/^name ada$/)).toBeInTheDocument();
    expect(screen.queryByRole("row")).not.toBeInTheDocument();

    // Record is the third switch, and it opens a panel under the rows.
    const record = screen.getByTitle("Record");
    await user.click(record);
    expect(record).toHaveAttribute("aria-pressed", "true");
    // …which reads the row the grid has selected, transposed.
    expect(await screen.findByText("Record 1 of 1")).toBeInTheDocument();
  });

  it("sorts on a header click and narrows on a filter", async () => {
    const user = userEvent.setup();
    givenASucceededExecution();
    getQueryResults.mockResolvedValue({
      columnNames: ["name"],
      rows: [["name"], ["grace"], ["ada"]]
    });
    renderWorkspace();
    await openCatalog();
    await runAndShowResults(user);
    await screen.findByText("grace");

    // As loaded, the page is in the order Athena sent it.
    expect(drawnColumns()).toEqual(["grace", "ada"]);

    // First click sorts ascending; the header is the sort control.
    await user.click(screen.getByRole("button", { name: "Sort by name" }));
    expect(drawnColumns()).toEqual(["ada", "grace"]);

    const box = screen.getByLabelText("Filter results");
    await user.type(box, "name = 'grace'{Enter}");
    expect(await screen.findByText("1 of 2 rows match")).toBeInTheDocument();
    expect(drawnColumns()).toEqual(["grace"]);
  });

  it("puts the status and the export in the strip, and nothing above the grid", async () => {
    const user = userEvent.setup();
    givenASucceededExecution();
    getQueryResults.mockResolvedValue({ columnNames: ["name"], rows: [["name"], ["ada"]] });
    renderWorkspace();
    await openCatalog();
    await runAndShowResults(user);
    await screen.findByText("ada");

    // Scanned is Athena's own fact, and the strip has a place for it; the engine
    // time and the row count are the shared cluster's.
    expect(screen.getByText(/Scanned:/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText("1.500s")).toBeInTheDocument();
    expect(screen.getByText("1 row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();

    // Nothing paged by offset is offered, because Athena cannot page by offset.
    expect(screen.queryByRole("button", { name: "Next page · re-runs the query" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Rows per page")).not.toBeInTheDocument();
    // And the old panel's status line is gone rather than duplicated.
    expect(screen.queryByText(/Engine time:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Rows:/)).not.toBeInTheDocument();
  });

  it("asks for the next page with the token the last one left, and appends it", async () => {
    const user = userEvent.setup();
    givenASucceededExecution();
    getQueryResults
      .mockResolvedValueOnce({
        columnNames: ["name"],
        rows: [["name"], ["ada"]],
        nextToken: "tok-2"
      })
      .mockResolvedValueOnce({
        columnNames: ["name"],
        rows: [["name"], ["grace"]]
      });
    renderWorkspace();
    await openCatalog();
    await runAndShowResults(user);
    await screen.findByText("ada");

    await user.click(screen.getByRole("button", { name: "Load more rows" }));

    await waitFor(() => expect(drawnColumns()).toEqual(["ada", "grace"]));
    // The first page's rows are still there: a cursor appends rather than
    // replaces, which is the whole difference from the JDBC pager.
    expect(getQueryResults).toHaveBeenLastCalledWith({
      accountId: "acct-a",
      queryExecutionId: "exec-1",
      nextToken: "tok-2",
      maxResults: 1000
    });
    // Nothing left to ask for, so the button is not offered at all.
    expect(screen.queryByRole("button", { name: "Load more rows" })).not.toBeInTheDocument();
  });

  it("says why a failed run has no rows rather than drawing an empty grid", async () => {
    const user = userEvent.setup();
    givenAFailedExecution("Table 'default.missing' does not exist");
    startQuery.mockResolvedValue({ queryExecutionId: "exec-1", state: "FAILED" });
    renderWorkspace();
    await openCatalog();
    await runAndShowResults(user);

    expect(await screen.findByText(/Table 'default\.missing' does not exist/)).toBeInTheDocument();
    expect(
      screen.getByText("The run failed, so there are no rows to show.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("row")).not.toBeInTheDocument();
    // A failed run fetched nothing, so it has nothing to export.
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
    expect(getQueryResults).not.toHaveBeenCalled();
  });
});
