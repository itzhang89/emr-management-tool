import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlueCatalogTab } from "./GlueCatalogTab";
import { TooltipProvider } from "@/components/ui/tooltip";

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
vi.mock("@/hooks/useAthena", () => ({
  useStartAthenaQuery: () => ({ mutateAsync: startQuery, isPending: false }),
  useStopAthenaQuery: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportAthenaQueryCsv: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAthenaWorkgroups: () => ({
    data: [{ name: "primary", outputLocation: "s3://example-results/athena" }],
    isLoading: false
  }),
  useAthenaQueryExecution: () => ({ data: undefined })
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

vi.mock("@/services/athenaService", () => ({
  athenaService: { getQueryResults: vi.fn() }
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
  // A finished run, not one in flight: the strip marks a running tab with a
  // "● " in front of its name, which is not what these names are about.
  startQuery.mockResolvedValue({ queryExecutionId: "exec-1", state: "SUCCEEDED" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

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
