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
const listDbTables = vi.fn().mockImplementation(async (_connectionId: string, database: string) => {
  if (database === "sales") {
    return [
      { name: "orders", kind: "BASE TABLE" },
      { name: "customers", kind: "BASE TABLE" }
    ];
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

function connection(overrides: Partial<{ database?: string }> = {}) {
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

function renderWorkspace(conn = connection()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConnectionQueryTab connection={conn as never} />
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
  it("lands inside the connection's default database and shows its tables", async () => {
    renderWorkspace();

    // The header shows the entered database, its tables are loaded.
    expect(await screen.findByText("sales")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "customers" })).toBeInTheDocument();
    await waitFor(() => expect(listDbTables).toHaveBeenCalledWith("c1", "sales"));
  });

  it("backs out to the full database list", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "customers" });
    await user.click(screen.getByRole("button", { name: "Back to all databases" }));

    // All databases listed again; no table header.
    expect(await screen.findByRole("button", { name: "reporting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sales" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "customers" })).not.toBeInTheDocument();
  });

  it("entering another database loads its tables", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("button", { name: "customers" });
    await user.click(screen.getByRole("button", { name: "Back to all databases" }));
    await user.click(await screen.findByRole("button", { name: "reporting" }));

    expect(await screen.findByRole("button", { name: "reporting_rows" })).toBeInTheDocument();
    await waitFor(() => expect(listDbTables).toHaveBeenCalledWith("c1", "reporting"));
  });

  it("without a default database it lists all databases first", async () => {
    renderWorkspace(connection({ database: undefined }));

    expect(await screen.findByRole("button", { name: "sales" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "reporting" })).toBeInTheDocument();
    // No database entered → no table rows shown.
    expect(screen.queryByRole("button", { name: "customers" })).not.toBeInTheDocument();
  });
});
