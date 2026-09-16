import { render, screen, waitFor } from "@testing-library/react";
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
const listDbTables = vi
  .fn()
  .mockImplementation(async (_connectionId: string, database: string, schema: string) => {
    if (database === "sales") {
      return [
        { name: "orders", kind: "BASE TABLE" },
        { name: "customers", kind: "BASE TABLE" }
      ];
    }
    if (database === "analytics") {
      return [{ name: `${schema}_events`, kind: "BASE TABLE" }];
    }
    return [{ name: `${database}_rows`, kind: "BASE TABLE" }];
  });
const runDbQuery = vi.fn().mockResolvedValue({
  columns: ["id"],
  rows: [{ id: "1" }],
  rowCount: 1,
  truncated: false,
  durationMs: 3
});

vi.mock("@/services/tauriClient", () => ({
  tauriClient: {
    listDbConnections: (...args: unknown[]) => listDbConnections(...args),
    listDbDatabases: (...args: unknown[]) => listDbDatabases(...args),
    listDbSchemas: (...args: unknown[]) => listDbSchemas(...args),
    listDbTables: (...args: unknown[]) => listDbTables(...args),
    runDbQuery: (...args: unknown[]) => runDbQuery(...args)
  }
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

function connection(overrides: Partial<{ database?: string; kind: string }> = {}) {
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
    sortOrder: 0,
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
    ...overrides
  };
}

function renderWorkspace(conn = connection(), active = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConnectionQueryTab connection={conn as never} active={active} />
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
    expect(listDbTables).not.toHaveBeenCalled();

    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <ConnectionQueryTab connection={connection() as never} active />
        </TooltipProvider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(listDbDatabases).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(listDbTables).toHaveBeenCalledWith("c1", "sales", ""));
  });

  it("lands inside the connection's default database and shows its tables", async () => {
    renderWorkspace();

    // The header shows the entered database, its tables are loaded.
    expect(await screen.findByText("sales")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "customers" })).toBeInTheDocument();
    await waitFor(() => expect(listDbTables).toHaveBeenCalledWith("c1", "sales", ""));
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
    await waitFor(() => expect(listDbTables).toHaveBeenCalledWith("c1", "reporting", ""));
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
    expect(listDbTables).toHaveBeenCalledWith("c1", "analytics", "staging");
  });

  it("skips the schema level when the database has exactly one", async () => {
    renderWorkspace(connection({ kind: "postgres", database: "warehouse" }));

    // One schema is not a choice worth a click: its tables are already listed.
    expect(await screen.findByRole("button", { name: "warehouse_rows" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "public" })).not.toBeInTheDocument();
    expect(listDbTables).toHaveBeenCalledWith("c1", "warehouse", "public");
  });

  it("qualifies an inserted table by its schema, not its database", async () => {
    const user = userEvent.setup();
    renderWorkspace(connection({ kind: "postgres", database: "warehouse" }));

    await user.click(await screen.findByRole("button", { name: "warehouse_rows" }));

    // Postgres rejects `database.table` outright — the qualifier has to be the
    // schema. On MySQL the schema *is* the database, so this reads the same.
    expect(screen.getByLabelText("SQL editor")).toHaveValue(
      "SELECT * FROM public.warehouse_rows LIMIT 100;"
    );
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
