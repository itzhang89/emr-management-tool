import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ConnectionQueryTab } from "./ConnectionQueryTab";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const listDbConnections = vi.fn().mockResolvedValue([]);
const listDbDatabases = vi.fn().mockResolvedValue([
  { name: "sales" },
  { name: "reporting" },
  { name: "system" }
]);
// Schemas per database, as the engines answer them: MySQL has no such level
// (it answers with nothing, which is how the tree learns to skip it), while a
// Postgres database may have several — or exactly one, which it also skips.
const SCHEMAS: Record<string, string[]> = {
  analytics: ["public", "staging"],
  warehouse: ["public"]
};
const listDbSchemas = vi
  .fn()
  .mockImplementation(async (_connectionId: string, database: string) =>
    (SCHEMAS[database] ?? []).map((name) => ({ name }))
  );
// Kinds come back already normalised — the driver maps each engine's own
// vocabulary onto these in SQL, so this is what the WebView actually receives.
const listDbObjects = vi
  .fn()
  .mockImplementation(
    async (_connectionId: string, database: string, schema: string, kinds: string[]) => {
      if (kinds.includes("view") && database === "sales") {
        return [
          { name: "orders", kind: "table" },
          { name: "customers", kind: "table" },
          { name: "recent_orders", kind: "view" }
        ];
      }
      if (database === "sales") {
        return [
          { name: "orders", kind: "table" },
          { name: "customers", kind: "table" }
        ];
      }
      if (database === "analytics") {
        return [{ name: `${schema}_events`, kind: "table" }];
      }
      return [{ name: `${database}_rows`, kind: "table" }];
    }
  );
const runDbQuery = vi.fn().mockResolvedValue(page(1, 0, false));
// Counting re-runs the statement, so it is asked for on its own and never
// happens as a side effect of a run.
const countDbQuery = vi.fn().mockResolvedValue({ count: 1, durationMs: 2 });
const cancelDbQuery = vi.fn().mockResolvedValue(true);
const refreshDbCatalog = vi.fn().mockResolvedValue(undefined);
const saveTextFile = vi.fn().mockResolvedValue(undefined);

/** One page of a ho-hum result; `next` decides whether there is another. */
function page(rows: number, offset: number, truncated: boolean) {
  return {
    columns: ["id"],
    rows: Array.from({ length: rows }, (_, index) => ({ id: offset + index })),
    rowCount: rows,
    truncated,
    durationMs: 3,
    offset,
    nextOffset: truncated ? offset + rows : null,
    pageable: true,
    catalogChanged: false
  };
}

/**
 * A page with columns worth filtering on.
 *
 * Every value is distinct apart from `time_zone`, where two rows differ only in
 * case — which is what makes it useful: the grid's own comparator says those
 * two are the same value, and a filter that disagreed with the sort about that
 * would put a row on the wrong side of a line the user drew.
 */
function zonePage() {
  const rows = [
    { id: 1, time_zone: "UTC", region: "us-east" },
    { id: 2, time_zone: "utc", region: "eu-west" },
    { id: 3, time_zone: "Asia/Tokyo", region: "ap-northeast" }
  ];
  return {
    columns: ["id", "time_zone", "region"],
    rows,
    rowCount: rows.length,
    truncated: false,
    durationMs: 3,
    offset: 0,
    nextOffset: null,
    pageable: true,
    catalogChanged: false
  };
}

/** A page with a NULL in it: the one cell whose menu has fewer questions. */
function notePage() {
  const rows = [
    { id: 1, note: null },
    { id: 2, note: "x" },
    { id: 3, note: "y" }
  ];
  return {
    columns: ["id", "note"],
    rows,
    rowCount: rows.length,
    truncated: false,
    durationMs: 3,
    offset: 0,
    nextOffset: null,
    pageable: true,
    catalogChanged: false
  };
}

/**
 * Right-click a cell and walk into its Filter submenu.
 *
 * By keyboard, because that is the path somebody without a mouse takes and it
 * is the one jsdom can drive honestly: the sub-trigger opens on the arrow key,
 * on a click, or on a pointer resting over it — and of the three, the first two
 * are reaches this test can make, while the third needs a pointer it has not
 * got.
 */
function openFilterMenu(cell: HTMLElement) {
  fireEvent.contextMenu(cell);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Filter" }), { key: "ArrowRight" });
}

/**
 * Right-click a cell and pick one of the comparisons its menu offers.
 *
 * The item is named and clicked in one turn of the loop, with nothing awaited
 * between them, and that is deliberate. The submenu is opened by the line
 * before, so the item is already on the page; asking for it again *after* an
 * await is asking about a page that has since been drawn again, and a click on
 * the node from the earlier drawing lands on something no longer in the
 * document — which no handler ever sees, and which reads as a menu that ignored
 * the click rather than as a stale node. A pointer in a browser has the same
 * relationship to the page as this click does: it lands on whatever is there
 * when it lands.
 */
function filterBy(cell: HTMLElement, label: string) {
  openFilterMenu(cell);
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

vi.mock("@/services/tauriClient", () => ({
  tauriClient: {
    listDbConnections: (...args: unknown[]) => listDbConnections(...args),
    listDbDatabases: (...args: unknown[]) => listDbDatabases(...args),
    listDbSchemas: (...args: unknown[]) => listDbSchemas(...args),
    listDbObjects: (...args: unknown[]) => listDbObjects(...args),
    runDbQuery: (...args: unknown[]) => runDbQuery(...args),
    countDbQuery: (...args: unknown[]) => countDbQuery(...args),
    cancelDbQuery: (...args: unknown[]) => cancelDbQuery(...args),
    refreshDbCatalog: (...args: unknown[]) => refreshDbCatalog(...args),
    saveTextFile: (...args: unknown[]) => saveTextFile(...args)
  }
}));

// Mocked at this layer, not at `tauriClient`: outside the Tauri runtime the
// helper downloads through a browser blob, so the client is never reached.
vi.mock("@/services/fileDownload", () => ({
  saveTextFile: (...args: unknown[]) => saveTextFile(...args)
}));

vi.mock("@/hooks/useAwsSettings", () => ({
  useAwsAccounts: () => ({ data: [], isLoading: false }),
  useActiveAwsAccount: () => ({ data: { id: "acct-a", name: "Test", region: "us-east-1" } }),
  useSetActiveAwsAccount: () => ({ mutate: vi.fn(), isPending: false })
}));

const storage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = String(value);
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    Object.keys(storage).forEach((key) => delete storage[key]);
  },
  get length() {
    return Object.keys(storage).length;
  },
  key: () => null
});

function connection(overrides: Partial<{ database?: string; kind: string; allowWrites: boolean }> = {}) {
  return {
    id: "c1",
    accountId: "acct-a",
    kind: "mysql",
    name: "Sales MySQL",
    host: "10.0.0.1",
    port: 3306,
    database: "sales",
    username: "reader",
    showAsTab: true,
    enabledForAi: true,
    aiReadOnlyPolicy: "select-only",
    allowWrites: false,
        authMode: "manual",
    sortOrder: 0,
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
    ...overrides
  };
}

function renderWorkspace(
  conn = connection(),
  active = true,
  // A tab with nowhere to send the request draws no AI action at all, so a
  // test that wants to see one has to say where it goes.
  onOpenAiAssistant?: () => void
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConnectionQueryTab
          connection={conn as never}
          active={active}
          onOpenAiAssistant={onOpenAiAssistant}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(storage).forEach((key) => delete storage[key]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ConnectionQueryTab", () => {
  it("does not request catalog metadata until the connection tab is active", async () => {
    const view = renderWorkspace(connection(), false);

    await waitFor(() => expect(listDbDatabases).not.toHaveBeenCalled());
    expect(listDbObjects).not.toHaveBeenCalled();

    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <ConnectionQueryTab connection={connection() as never} active />
        </TooltipProvider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(listDbDatabases).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(listDbObjects).toHaveBeenCalledWith("c1", "sales", "", ["table"]));
  });

  it("lands inside the connection's default database and shows its tables", async () => {
    renderWorkspace();

    // The header shows the entered database, its tables are loaded.
    expect(await screen.findByText("sales")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "customers" })).toBeInTheDocument();
    await waitFor(() => expect(listDbObjects).toHaveBeenCalledWith("c1", "sales", "", ["table"]));
  });

  it("backs out to the full database list", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "customers" });
    await user.click(screen.getByRole("button", { name: "Back one level" }));

    // All databases listed again; no table header.
    expect(await screen.findByRole("button", { name: "reporting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sales" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "customers" })).not.toBeInTheDocument();
  });

  it("entering another database loads its tables", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "customers" });
    await user.click(screen.getByRole("button", { name: "Back one level" }));
    await user.click(await screen.findByRole("button", { name: "reporting" }));

    expect(await screen.findByRole("button", { name: "reporting_rows" })).toBeInTheDocument();
    await waitFor(() => expect(listDbObjects).toHaveBeenCalledWith("c1", "reporting", "", ["table"]));
  });

  it("without a default database it lists all databases first", async () => {
    renderWorkspace(connection({ database: undefined }));

    expect(await screen.findByRole("button", { name: "sales" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "reporting" })).toBeInTheDocument();
    // No database entered → no table rows shown.
    expect(screen.queryByRole("button", { name: "customers" })).not.toBeInTheDocument();
  });

  it("walks database → schema → tables when the database has schemas to choose", async () => {
    const user = userEvent.setup();
    renderWorkspace(connection({ kind: "postgres", database: "analytics" }));

    // Inside "analytics" the choice is which schema, so no tables yet.
    expect(await screen.findByRole("button", { name: "staging" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "public" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "public_events" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "staging" }));

    expect(await screen.findByRole("button", { name: "staging_events" })).toBeInTheDocument();
    expect(listDbObjects).toHaveBeenCalledWith("c1", "analytics", "staging", ["table"]);
  });

  it("skips the schema level when the database has exactly one", async () => {
    renderWorkspace(connection({ kind: "postgres", database: "warehouse" }));

    // One schema is not a choice worth a click: its tables are already listed.
    expect(await screen.findByRole("button", { name: "warehouse_rows" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "public" })).not.toBeInTheDocument();
    expect(listDbObjects).toHaveBeenCalledWith("c1", "warehouse", "public", ["table"]);

  });

  it("qualifies an inserted table by its schema, not its database", async () => {
    const user = userEvent.setup();
    renderWorkspace(connection({ kind: "postgres", database: "warehouse" }));

    await user.click(await screen.findByRole("button", { name: "warehouse_rows" }));

    // Postgres rejects `database.table` outright — the qualifier has to be the
    // schema — and it folds unquoted names to lower case, so both parts are
    // quoted or a table named `MyTable` would be unreachable. The editor is a
    // contenteditable, so its document reads as text.
    expect(screen.getByLabelText("SQL editor")).toHaveTextContent(
      'SELECT * FROM "public"."warehouse_rows" LIMIT 100;'
    );
  });

  it("runs into the editor's own result tab, named Result 1", async () => {
    const user = userEvent.setup();
    renderWorkspace(connection({ kind: "postgres", database: "warehouse" }));

    // A fresh editor has no results yet — the strip says where they will go.
    expect(await screen.findByText("Run a query to see results here.")).toBeInTheDocument();

    // Clicking a table writes its SELECT into the editor; running opens the
    // first result tab, numbered rather than named after the table. The table
    // arrives with the catalog query, so this waits for it rather than
    // assuming it landed alongside the editor.
    await user.click(await screen.findByRole("button", { name: "warehouse_rows" }));
    await user.click(screen.getByRole("button", { name: "Run query" }));

    await waitFor(() => expect(runDbQuery).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();
  });

  it("gives a run-in-new-tab one of its own, and keeps running into it", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await waitFor(() => expect(runDbQuery).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    expect(await screen.findByRole("button", { name: "Result 2" })).toBeInTheDocument();

    // A plain run replaces the tab on screen instead of opening a third.
    await user.click(screen.getByRole("button", { name: "Result 1" }));
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(runDbQuery).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("button", { name: "Result 3" })).not.toBeInTheDocument();
  });

  it("gives each editor its own results", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Run query" }));
    await screen.findByRole("button", { name: "Result 1" });

    // A second editor starts empty: results belong to the editor, not the page.
    await user.click(screen.getByRole("button", { name: "New query tab" }));
    expect(await screen.findByRole("button", { name: "Query 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Result 1" })).not.toBeInTheDocument();
    expect(screen.getByText("Run a query to see results here.")).toBeInTheDocument();

    // Back to the first editor: its result is still there, untouched.
    await user.click(screen.getByRole("button", { name: "Query 1" }));
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();
    expect(screen.queryByText("Run a query to see results here.")).not.toBeInTheDocument();
  });

  it("closes an editor's results with the editor", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "New query tab" }));
    await screen.findByRole("button", { name: "Query 2" });
    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await screen.findByRole("button", { name: "Result 1" });

    await user.click(screen.getByRole("button", { name: "Close Query 2" }));

    // Query 1 is back on screen and has never run, so its strip is empty again.
    expect(await screen.findByRole("button", { name: "Query 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Result 1" })).not.toBeInTheDocument();
  });

  it("writes a clicked table into the editor on screen, not into every editor", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "orders" });
    await user.click(screen.getByRole("button", { name: "New query tab" }));
    await screen.findByRole("button", { name: "Query 2" });

    // The second editor is still on the default statement.
    expect(screen.getByLabelText("SQL editor")).toHaveTextContent("SELECT 1;");

    await user.click(screen.getByRole("button", { name: "orders" }));
    expect(screen.getByLabelText("SQL editor")).toHaveTextContent(
      "SELECT * FROM `sales`.`orders` LIMIT 100;"
    );

    // And the first editor never saw it — each tab is its own document.
    await user.click(screen.getByRole("button", { name: "Query 1" }));
    expect(screen.getByLabelText("SQL editor")).toHaveTextContent("SELECT 1;");
  });

  it("closes a result tab and drops the close buttons once one is left", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await screen.findByRole("button", { name: "Result 1" });
    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await screen.findByRole("button", { name: "Result 2" });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Close / })).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Close Result 1" }));

    expect(screen.queryByRole("button", { name: "Result 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Result 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Close / })).not.toBeInTheDocument();
  });

  it("hides the catalog and brings it back", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "customers" });
    await user.click(screen.getByRole("button", { name: "Collapse catalog panel" }));

    // Out of the way, with only the way back left behind.
    expect(screen.queryByRole("button", { name: "customers" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand catalog panel" }));

    expect(await screen.findByRole("button", { name: "customers" })).toBeInTheDocument();
  });

  it("stops a run and says so in the tab rather than in an error", async () => {
    const user = userEvent.setup();
    // The backend answers a stop with its own code, and a stopped run is a
    // state the user asked for — not a failure to apologise for.
    runDbQuery.mockRejectedValueOnce({ code: "Cancelled", message: "Query cancelled." });
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Run query" }));

    // The run still gets the tab it would have filled, saying only that it was
    // stopped: silence would leave the user wondering whether the click landed.
    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Stopped before it returned any rows.")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("only offers the stop button while something is running", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const stop = await screen.findByRole("button", { name: "Stop query" });
    expect(stop).toBeDisabled();

    // A run that never settles keeps the button live.
    runDbQuery.mockImplementationOnce(() => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop query" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Stop query" }));
    // The run's id is the WebView's own, so only its shape is assertable.
    expect(cancelDbQuery).toHaveBeenCalledWith(expect.any(String));
  });

  it("shows one page at a time, and can step both ways", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    // A full page, and the sentinel saying there is more after it.
    runDbQuery.mockResolvedValueOnce(page(200, 0, true));
    await user.click(screen.getByRole("button", { name: "Run query" }));
    const next = await screen.findByRole("button", { name: "Next page · re-runs the query" });
    // First page: nothing before it.
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    // The page after it is the last one, and a last page is short: one row
    // where a full page held two hundred.
    runDbQuery.mockResolvedValueOnce(page(1, 200, false));
    await user.click(next);

    // The second page was asked for by offset, at the tab's own page size —
    // and it *replaced* the first, which is what makes Previous meaningful.
    await waitFor(() =>
      expect(runDbQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 200, maxRows: 200, sql: "SELECT 1;" })
      )
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next page · re-runs the query" })).toBeDisabled()
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();

    // Back by a whole page, not by the rows on it: subtracting this page's one
    // row would land on 199 and skip everything between, without saying so.
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() =>
      expect(runDbQuery).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))
    );
  });

  it("will not offer the last page until a count has said where it is", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(page(2, 0, true));
    await user.click(screen.getByRole("button", { name: "Run query" }));

    const last = await screen.findByRole("button", { name: "Last page · needs a row count first" });
    expect(last).toBeDisabled();

    countDbQuery.mockResolvedValueOnce({ count: 500, durationMs: 4 });
    await user.click(screen.getByRole("button", { name: "Count" }));

    // Counting is explicit, so the number is only ever there because asked —
    // and it is what makes "last" a place that exists.
    expect(await screen.findByRole("button", { name: "500" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Last page · needs a row count first" })).toBeEnabled()
    );

    // 500 rows at 200 per page puts the last page at 400, not at 300.
    await user.click(screen.getByRole("button", { name: "Last page · needs a row count first" }));
    await waitFor(() =>
      expect(runDbQuery).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 400 }))
    );
  });

  it("says why a count failed instead of inventing a number", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(page(2, 0, false));
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await screen.findByRole("button", { name: "Count" });

    countDbQuery.mockRejectedValueOnce({ code: "Validation", message: "Only a single SELECT can be counted." });
    await user.click(screen.getByRole("button", { name: "Count" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only a single SELECT can be counted.")
    );
    // The button still says "Count": there is no number to show.
    expect(await screen.findByRole("button", { name: "Count" })).toBeInTheDocument();
  });

  it("exports the rows it has loaded", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(page(2, 0, false));
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await user.click(await screen.findByRole("button", { name: "Export" }));
    await user.click(await screen.findByRole("button", { name: /^CSV/ }));

    await waitFor(() => expect(saveTextFile).toHaveBeenCalled());
    expect(saveTextFile).toHaveBeenCalledWith("Result 1.csv", "id\n0\n1");
  });

  it("filters the loaded page by the value that was right-clicked", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(zonePage());
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));

    // The conditions on offer are comparisons against the value under the
    // pointer, which is the question a person has when they right-click one:
    // not "what can I do to this column" — the header answers that — but "show
    // me the rows like this one".
    filterBy(screen.getByTitle("us-east"), "region <> 'us-east'");

    // The condition is drawn above the rows with the count of what survived it.
    // The footer still counts the page, because a page is what it is: a filter
    // that quietly changed that number would be worse than no filter at all.
    expect(await screen.findByText("region <> 'us-east'")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 rows match")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    // And the choice is written into the box, which is where conditions live:
    // the chip is a reading of that expression, not a second copy of it.
    expect(screen.getByLabelText("Filter results")).toHaveValue("region <> 'us-east'");

    // The rows that are left keep the numbers they had on the page — 2 and 3,
    // not 1 and 2. A number says where a row came from, not how many are left,
    // which is also what the record panel counts by.
    expect(
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0]?.textContent)
    ).toEqual(["2", "3"]);

    // Nothing was asked of the server: the filter narrows the page in hand.
    expect(runDbQuery).toHaveBeenCalledTimes(1);
    // And the menu shut behind the choice, rather than staying over the rows.
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("asks a NULL cell only what it can answer, and empties the grid when the filter takes every row", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(notePage());
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));

    // A missing value has no magnitude to be greater or less than and nothing
    // to contain anything, so those three items would be offering to compare
    // against no value at all. Only the two that ask *whether* it is missing
    // are worth a click — and they are different questions from `= 'NULL'`,
    // four letters somebody may have stored on purpose.
    openFilterMenu(screen.getByTitle("NULL"));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Copy",
      "Filter",
      "note IS NULL",
      "note IS NOT NULL"
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "note IS NULL" }));
    expect(await screen.findByText("1 of 3 rows match")).toBeInTheDocument();

    // The row that survives is the one with the NULL, so `IS NOT NULL` — asked
    // of its own cell, which is the only cell left to ask it of — takes the
    // last row away. The grid then says which kind of nothing it is showing:
    // "no rows came back" and "your conditions took them all" are different
    // answers to different problems, and only one of them is worth removing a
    // condition over.
    filterBy(screen.getByTitle("NULL"), "note IS NOT NULL");
    expect(await screen.findByText("No rows on this page match the filter.")).toBeInTheDocument();
    expect(screen.getByText("0 of 3 rows match")).toBeInTheDocument();

    // Nothing to read one at a time, so the switch that opens a record is not
    // offered rather than opening onto an empty panel.
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  });

  it("takes one condition off, and all of them at once", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(zonePage());
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));

    // Two conditions, read as ANDs. The second is built from the value in row
    // 2, and row 1 would answer it as well — the grid's own comparator says
    // `UTC` and `utc` are one value. It is gone because of the *first*
    // condition, which is what makes the pair an AND rather than a choice of
    // two ways to match one row.
    filterBy(screen.getByTitle("us-east"), "region <> 'us-east'");
    filterBy(screen.getByTitle("utc"), "time_zone = 'utc'");
    expect(await screen.findByText("1 of 3 rows match")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);

    // Each chip is its own way out, so removing one leaves the other doing its
    // job: the row the second condition kept is the one the first allowed.
    await user.click(screen.getByRole("button", { name: "Remove filter: time_zone = 'utc'" }));
    expect(await screen.findByText("2 of 3 rows match")).toBeInTheDocument();
    expect(screen.queryByText("time_zone = 'utc'")).not.toBeInTheDocument();
    expect(screen.getByText("region <> 'us-east'")).toBeInTheDocument();
    // And the box is rewritten to match: taking a condition off is an edit to
    // the expression, not to a second list that shadows it.
    expect(screen.getByLabelText("Filter results")).toHaveValue("region <> 'us-east'");

    // Clearing takes the conditions and the strip with them — a bar reading
    // "3 of 3 rows match" would be a control panel for nothing.
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    expect(screen.queryByText("2 of 3 rows match")).not.toBeInTheDocument();
    expect(screen.queryByText("region <> 'us-east'")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter results")).toHaveValue("");
  });

  it("counts the record panel through the rows that survived the filter", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(zonePage());
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));

    filterBy(screen.getByTitle("us-east"), "region <> 'us-east'");
    await screen.findByText("2 of 3 rows match");

    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(await screen.findByText("Record 1 of 2")).toBeInTheDocument();

    // The first record is the first row *on screen*, not the first row the page
    // arrived with: the panel and the grid are reading the same rows in the
    // same order, which is the whole reason the two are paired up rather than
    // each working out its own idea of where row 2 is.
    const panel = screen.getByRole("rowheader", { name: "time_zone" }).closest("table");
    expect(within(panel!).getByText("utc")).toBeInTheDocument();
    expect(within(panel!).queryByText("UTC")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next record" }));
    expect(await screen.findByText("Record 2 of 2")).toBeInTheDocument();
    expect(within(panel!).getByText("Asia/Tokyo")).toBeInTheDocument();
  });

  it("exports what the filter left, not what the page held", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(zonePage());
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));

    filterBy(screen.getByTitle("us-east"), "region <> 'us-east'");
    await screen.findByText("2 of 3 rows match");

    // The file follows the view. A dump that carried the rows the user had
    // filtered off screen would be a different result from the one they were
    // looking at when they asked for it.
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(await screen.findByRole("button", { name: /^CSV/ }));

    await waitFor(() => expect(saveTextFile).toHaveBeenCalled());
    expect(saveTextFile).toHaveBeenCalledWith(
      "Result 1.csv",
      "id,time_zone,region\n2,utc,eu-west\n3,Asia/Tokyo,ap-northeast"
    );
  });

  it("filters by an expression typed whole, and keeps what parsed when one does not", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(zonePage());
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));

    // The box is where the conditions are written, so an expression typed whole
    // narrows the page the same way a menu choice does — and what is typed is
    // what the box goes on holding, rather than a tidied-up version of it.
    const box = screen.getByLabelText("Filter results");
    await user.type(box, "time_zone = 'utc' AND id > 1{Enter}");
    expect(await screen.findByText("1 of 3 rows match")).toBeInTheDocument();
    expect(screen.getByText("time_zone = 'utc'")).toBeInTheDocument();
    expect(screen.getByText("id > '1'")).toBeInTheDocument();
    expect(box).toHaveValue("time_zone = 'utc' AND id > 1");
    expect(screen.getAllByRole("row")).toHaveLength(2);

    // A half-written expression is not a filter: what was in force stays in
    // force, and the box says what it stumbled on rather than going quiet. The
    // alternative — reading `OR` as `AND` — would drop rows the user asked for
    // out of a grid that looks perfectly fine.
    await user.clear(box);
    await user.type(box, "time_zone = 'utc' OR id = 1{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("OR is not supported");
    expect(screen.getByText("1 of 3 rows match")).toBeInTheDocument();
    expect(box).toHaveValue("time_zone = 'utc' OR id = 1");

    // Editing the text takes the complaint away with it, and a question the
    // parser can answer puts the grid back.
    await user.clear(box);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(box, "region LIKE '%east%'{Enter}");
    expect(await screen.findByText("2 of 3 rows match")).toBeInTheDocument();
  });

  it("offers the result's own column names while an expression is typed", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(zonePage());
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));

    const box = screen.getByLabelText("Filter results");
    await user.click(box);

    // Ctrl+Space is the ask, and the names come from the result in hand rather
    // than from a list of SQL words.
    await user.keyboard("{Control>} {/Control}");
    expect(await screen.findByRole("button", { name: "time_zone" })).toBeInTheDocument();

    // Typing narrows the list, and picking from it leaves the caret after the
    // name so the comparison can be typed straight on.
    await user.type(box, "reg");
    await user.click(await screen.findByRole("button", { name: "region" }));
    expect(box).toHaveValue("region");
    expect(screen.queryByRole("button", { name: "time_zone" })).not.toBeInTheDocument();

    await user.type(box, " = 'us-east'{Enter}");
    expect(await screen.findByText("1 of 3 rows match")).toBeInTheDocument();
  });

  it("opens the record panel under the rows, whichever format they are in", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    runDbQuery.mockResolvedValueOnce(page(2, 0, false));
    await user.click(screen.getByRole("button", { name: "Run query" }));

    // The grid is where a result lands: header row plus both rows of the page,
    // and no panel under them yet. The rows themselves are the thing to wait
    // on — nothing else in the pane marks the moment the run was drawn.
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    expect(screen.queryByText(/Record 1 of/)).not.toBeInTheDocument();

    // Record is not a third format: it opens a pane *below* the rows and leaves
    // them alone, so the grid still draws the whole page.
    const record = screen.getByRole("button", { name: "Record" });
    expect(record).toHaveAttribute("aria-pressed", "false");
    await user.click(record);

    expect(await screen.findByText("Record 1 of 2")).toBeInTheDocument();
    // The page above is untouched — header, both rows — and the panel adds one
    // line for the one column this result has.
    expect(screen.getAllByRole("row")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "Next record" }));
    expect(await screen.findByText("Record 2 of 2")).toBeInTheDocument();

    // And it survives a change of format: the text dump shows every row on the
    // page, because the panel narrows nothing.
    await user.click(screen.getByRole("tab", { name: "Text" }));
    expect(await screen.findByText(/Tab-separated · 2 rows on this page/)).toBeInTheDocument();
    expect(screen.getByText("Record 2 of 2")).toBeInTheDocument();
  });

  it("keeps the AI action in the rail at the right edge, as narrow as the one opposite it", async () => {
    const user = userEvent.setup();
    renderWorkspace(connection(), true, vi.fn());

    runDbQuery.mockResolvedValueOnce(page(2, 0, false));
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));

    // Two rails frame the rows: the formats at the left end, the actions at the
    // right. They are one width on purpose. A wider rail reads as the more
    // important one, and the switch between Grid and Text is not worth less
    // than the single button that acts on the result — while the border on each
    // says which edge its own rail belongs to.
    //
    // Two steps up from the Grid tab: the tab, its tablist, the rail itself.
    expect(screen.getByRole("tab", { name: "Grid" }).parentElement?.parentElement).toHaveClass(
      "w-6",
      "border-r"
    );

    // The catalog is an `<aside>` as well, so the action's rail is the one
    // holding the action rather than simply the one on the page.
    const aiRail = screen
      .getAllByRole("complementary")
      .find((rail) => within(rail).queryByRole("button", { name: "Analyze with AI" }));
    expect(aiRail).toHaveClass("w-6", "border-l");

    // And it hugs that edge, in the same top band the source name sits in on
    // the other side of the grid, rather than floating in the gutter.
    expect(
      within(aiRail!).getByRole("button", { name: "Analyze with AI" }).parentElement
    ).toHaveClass("h-6", "justify-end");
  });

  it("copies the record the panel is showing, field names and all", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    renderWorkspace();

    runDbQuery.mockResolvedValueOnce({
      ...page(2, 0, false),
      columns: ["id", "name"],
      rows: [
        { id: 1, name: "a" },
        { id: 2, name: "b" }
      ]
    });
    await user.click(screen.getByRole("button", { name: "Run query" }));
    await user.click(await screen.findByRole("button", { name: "Record" }));

    await user.click(await screen.findByRole("button", { name: "Copy this record" }));
    // A record copied on its own has no header row, so the names travel with
    // it; a tab between the two so it lands in a spreadsheet as two columns.
    expect(writeText).toHaveBeenCalledWith("id\t1\nname\ta");

    // And it follows the panel rather than the page: stepping on copies the
    // record now on screen.
    await user.click(screen.getByRole("button", { name: "Next record" }));
    await user.click(screen.getByRole("button", { name: "Copy this record" }));
    expect(writeText).toHaveBeenLastCalledWith("id\t2\nname\tb");
  });

  it("heads the pane with the statement that produced the rows, above both rails", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "orders" });
    await user.click(screen.getByRole("button", { name: "orders" }));

    runDbQuery.mockResolvedValueOnce(page(1, 0, false));
    await user.click(screen.getByRole("button", { name: "Run query" }));

    // The strip already says "Result 1". What the pane adds is the query these
    // rows are the answer to, kept whole rather than guessed at from its FROM
    // clause — a statement is the one thing that says what a result is.
    //
    // Found by its text rather than by its title: the tab buttons carry the
    // same statement as their own title, and what is being asserted here is the
    // line in the pane, not the tabs. The title is then checked on it, because
    // the line is narrow enough to cut a long statement short and the whole of
    // it has to be somewhere.
    const sql = "SELECT * FROM `sales`.`orders` LIMIT 100;";
    const line = await screen.findByText(sql);
    expect(line).toHaveAttribute("title", sql);

    // And it heads the pane rather than the grid: it comes before the format
    // rail in the document, which is what puts the rail's first tab level with
    // the table's header row instead of a band below it.
    const rail = screen.getByRole("tab", { name: "Grid" }).parentElement?.parentElement;
    expect(line.compareDocumentPosition(rail!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("answers the catalog shortcut only while it is the visible tab", async () => {
    const user = userEvent.setup();

    // Hidden: the chord belongs to whichever workspace is on screen. This tab
    // is only *mounted*, and the Glue tab is mounted for good once opened, so
    // both would otherwise collapse at once.
    const hidden = renderWorkspace(connection(), false);
    await user.keyboard("{Meta>}\\{/Meta}");
    expect(screen.queryByRole("button", { name: "Expand catalog panel" })).not.toBeInTheDocument();
    hidden.unmount();

    renderWorkspace(connection(), true);
    await screen.findByRole("button", { name: "customers" });
    await user.keyboard("{Meta>}\\{/Meta}");
    expect(await screen.findByRole("button", { name: "Expand catalog panel" })).toBeInTheDocument();
  });

  it("offers templates a connection can actually run", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "SQL templates" }));

    // Glue's list is Hive DDL, every line of which the read-only gate refuses;
    // a JDBC workspace gets statements that will run.
    expect(await screen.findByRole("button", { name: "Sample rows" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CREATE DATABASE/ })).not.toBeInTheDocument();
  });

  it("remembers a query against the connection that ran it", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(runDbQuery).toHaveBeenCalled());

    // Keyed by account *and* connection: SQL is dialect-specific, so one
    // connection's history is not another's.
    expect(storage["emr-eks:dbhub-sql-history:acct-a:conn:c1"]).toContain("SELECT 1;");
  });

  it("quotes identifiers the way the engine does", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "orders" }));

    // MySQL's backticks, not Postgres's double quotes.
    expect(screen.getByLabelText("SQL editor")).toHaveTextContent(
      "SELECT * FROM `sales`.`orders` LIMIT 100;"
    );
  });

  it("shows the object kinds the engine has, tables alone to start", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "orders" });
    await user.click(screen.getByRole("button", { name: "Choose what to show" }));

    // MySQL's list, with tables ticked and the rest offered.
    expect(await screen.findByRole("checkbox", { name: "Tables" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Views" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Procedures" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Events" })).toBeInTheDocument();
    // Postgres-only kinds are not offered here.
    expect(screen.queryByRole("checkbox", { name: "Materialized Views" })).not.toBeInTheDocument();
  });

  it("asks the backend for the kinds that are ticked", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "orders" });
    await user.click(screen.getByRole("button", { name: "Choose what to show" }));
    await user.click(await screen.findByRole("checkbox", { name: "Views" }));

    // Fetching the newly-ticked kind rather than filtering a list that never
    // held it — and the view it brought back is listed alongside the tables.
    await waitFor(() =>
      expect(listDbObjects).toHaveBeenLastCalledWith("c1", "sales", "", ["table", "view"])
    );
    expect(await screen.findByRole("button", { name: "recent_orders" })).toBeInTheDocument();
  });

  it("clears the backend's cached tree when the refresh button is used", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "orders" });
    await user.click(screen.getByRole("button", { name: "Refresh catalog" }));

    // The Rust side serves a same-day cache, so invalidating the WebView's
    // copy alone would re-run the query and be handed the same answer back.
    await waitFor(() => expect(refreshDbCatalog).toHaveBeenCalledWith("c1"));
  });

  it("says whether this connection may write", async () => {
    renderWorkspace(connection({ allowWrites: true }));

    // The badge is the only place the workspace says which side of the line
    // the statement about to run is on.
    expect(await screen.findByText("Write")).toBeInTheDocument();
    expect(screen.getByText(/writes allowed here/)).toBeInTheDocument();
  });

  it("steps back one level at a time", async () => {
    const user = userEvent.setup();
    renderWorkspace(connection({ kind: "postgres", database: "analytics" }));

    await user.click(await screen.findByRole("button", { name: "staging" }));
    await screen.findByRole("button", { name: "staging_events" });

    // Tables → schemas, not all the way out to databases.
    await user.click(screen.getByRole("button", { name: "Back one level" }));
    expect(await screen.findByRole("button", { name: "public" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "reporting" })).not.toBeInTheDocument();

    // Schemas → databases.
    await user.click(screen.getByRole("button", { name: "Back one level" }));
    expect(await screen.findByRole("button", { name: "reporting" })).toBeInTheDocument();
  });
});

/**
 * The two strips are one above the other and answer to the same keys, so which
 * half the user is in is the whole question these tests ask. It is set by
 * where the pointer and the keyboard have been — a click in the editor, on a
 * query tab, in the grid or on a result tab — and these drive it the way a
 * person does, by clicking.
 */
describe("ConnectionQueryTab keyboard and split", () => {
  it("opens another editor on ⌘N", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: "customers" });

    await user.keyboard("{Meta>}n{/Meta}");

    expect(await screen.findByRole("button", { name: "Query 2" })).toBeInTheDocument();
  });

  it("closes the editor in front on ⌘W, and refuses the last one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: "customers" });

    await user.keyboard("{Meta>}n{/Meta}");
    await screen.findByRole("button", { name: "Query 2" });

    await user.keyboard("{Meta>}w{/Meta}");
    expect(screen.queryByRole("button", { name: "Query 2" })).not.toBeInTheDocument();

    // The last editor is not closable, and is not replaced by a blank one
    // either: ⌘W simply does nothing rather than leaving the user with an
    // empty document where their statement was.
    await user.keyboard("{Meta>}w{/Meta}");
    expect(screen.getAllByRole("button", { name: /^Query \d+$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Query 1" })).toBeInTheDocument();
  });

  it("closes the result tab in front when the result half was last used", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: "customers" });

    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await screen.findByRole("button", { name: "Result 1" });
    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await screen.findByRole("button", { name: "Result 2" });

    // Clicking a result tab is what puts the user in the result half.
    await user.click(screen.getByRole("button", { name: "Result 1" }));
    await user.keyboard("{Meta>}w{/Meta}");

    expect(screen.queryByRole("button", { name: "Result 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Result 2" })).toBeInTheDocument();
    // The editor it belonged to is untouched — the key closed a result, not
    // the statement that produced it.
    expect(screen.getByRole("button", { name: "Query 1" })).toBeInTheDocument();
  });

  it("leaves a lone result tab alone on ⌘W", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: "customers" });

    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await user.click(await screen.findByRole("button", { name: "Result 1" }));

    await user.keyboard("{Meta>}w{/Meta}");

    expect(screen.getByRole("button", { name: "Result 1" })).toBeInTheDocument();
  });

  it("walks the editor strip on ⌘⇧[ when the editor half was last used", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: "customers" });

    await user.click(screen.getByRole("button", { name: "Run query" }));
    await screen.findByRole("button", { name: "Result 1" });

    // A second editor starts with no results of its own, which is how the test
    // can tell which one is on screen without reading a CSS class.
    await user.keyboard("{Meta>}n{/Meta}");
    await screen.findByRole("button", { name: "Query 2" });
    expect(screen.queryByRole("button", { name: "Result 1" })).not.toBeInTheDocument();

    await user.keyboard("{Meta>}{Shift>}{[}{/Shift}{/Meta}");

    expect(await screen.findByRole("button", { name: "Result 1" })).toBeInTheDocument();
  });

  it("walks the result strip on ⌘⇧] when the result half was last used", async () => {
    const user = userEvent.setup();
    // Two runs of one statement, told apart by a column only the second has.
    runDbQuery
      .mockResolvedValueOnce(page(1, 0, false))
      .mockResolvedValueOnce({
        ...page(2, 0, false),
        columns: ["order_id"],
        rows: [{ order_id: 1 }, { order_id: 2 }]
      });
    renderWorkspace();
    await screen.findByRole("button", { name: "customers" });

    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await screen.findByRole("button", { name: "Result 1" });
    await user.click(screen.getByRole("button", { name: "Run in new tab" }));
    await screen.findByRole("button", { name: "Result 2" });
    expect(screen.getByText("order_id")).toBeInTheDocument();

    // Step back to the first result; the grid says which one is on screen.
    await user.click(screen.getByRole("button", { name: "Result 1" }));
    expect(screen.queryByText("order_id")).not.toBeInTheDocument();

    await user.keyboard("{Meta>}{Shift>}]{/Shift}{/Meta}");

    expect(await screen.findByText("order_id")).toBeInTheDocument();
  });

  it("resizes the editor against the grid", async () => {
    renderWorkspace();
    await screen.findByRole("button", { name: "customers" });

    const handle = screen.getByRole("separator", { name: "Resize the editor and result areas" });
    expect(handle).toHaveAttribute("aria-valuenow", "220");

    fireEvent.mouseDown(handle, { clientY: 100 });
    fireEvent.mouseMove(document, { clientY: 180 });
    fireEvent.mouseUp(document);

    expect(handle).toHaveAttribute("aria-valuenow", "300");
  });

  it("will not drag the editor away entirely", async () => {
    renderWorkspace();
    await screen.findByRole("button", { name: "customers" });

    const handle = screen.getByRole("separator", { name: "Resize the editor and result areas" });

    // Up, past the editor's own floor of 140px.
    fireEvent.mouseDown(handle, { clientY: 400 });
    fireEvent.mouseMove(document, { clientY: 0 });
    fireEvent.mouseUp(document);
    expect(handle).toHaveAttribute("aria-valuenow", "140");

    // And down, past the tallest it is allowed to get: the grid has to keep
    // some of the column whichever way the handle is pulled.
    fireEvent.mouseDown(handle, { clientY: 0 });
    fireEvent.mouseMove(document, { clientY: 4000 });
    fireEvent.mouseUp(document);
    expect(handle).toHaveAttribute("aria-valuenow", "560");
  });
});
