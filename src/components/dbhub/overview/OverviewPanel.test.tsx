import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewPanel } from "./OverviewPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const setConnectionFlags = vi.fn().mockResolvedValue({ id: "c1", name: "Sales MySQL" });
const deleteConnection = vi.fn().mockResolvedValue([]);
const saveProfile = vi.fn().mockResolvedValue({ id: "p1", name: "Office tunnel" });
const deleteProfile = vi.fn().mockResolvedValue(undefined);
const testProfile = vi.fn().mockResolvedValue({ ok: true, message: "ok", latencyMs: 3 });

vi.mock("@/services/tauriClient", () => ({
  tauriClient: {
    listDbConnections: vi.fn().mockResolvedValue([
      {
        id: "c1",
        accountId: "acct-a",
        kind: "mysql",
        name: "Sales MySQL",
        host: "10.0.0.1",
        port: 3306,
        database: "sales",
        username: "bi_reader",
        showAsTab: true,
        enabledForAi: false,
        aiReadOnlyPolicy: "select-only",
        sortOrder: 0,
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z"
      },
      {
        id: "c2",
        accountId: "acct-a",
        kind: "postgres",
        name: "Warehouse",
        host: "10.0.0.2",
        port: 5432,
        username: "reader",
        networkProfileId: "p1",
        showAsTab: false,
        enabledForAi: true,
        aiReadOnlyPolicy: "select-only",
        sortOrder: 1,
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z"
      }
    ]),
    listNetworkProfiles: vi.fn().mockResolvedValue([
      {
        id: "p1",
        accountId: "acct-a",
        name: "Office tunnel",
        transport: {
          type: "ssh-tunnel",
          host: "10.20.30.40",
          port: 22,
          username: "root",
          authMethod: "password",
          credentialsSaved: true
        },
        enabled: true,
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z"
      }
    ]),
    setDbConnectionFlags: (...args: unknown[]) => setConnectionFlags(...args),
    deleteDbConnection: (...args: unknown[]) => deleteConnection(...args),
    saveNetworkProfile: (...args: unknown[]) => saveProfile(...args),
    deleteNetworkProfile: (...args: unknown[]) => deleteProfile(...args),
    testNetworkProfile: (...args: unknown[]) => testProfile(...args)
  }
}));

vi.mock("@/hooks/useAwsSettings", () => ({
  useAwsAccounts: () => ({ data: [], isLoading: false }),
  useActiveAwsAccount: () => ({ data: { id: "acct-a", name: "Test", region: "us-east-1" } }),
  useSetActiveAwsAccount: () => ({ mutate: vi.fn(), isPending: false })
}));

function renderOverview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <OverviewPanel />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("OverviewPanel", () => {
  it("lists connection cards with routing info and switch states", async () => {
    renderOverview();

    expect(await screen.findByText("Sales MySQL")).toBeInTheDocument();
    expect(screen.getByText("Warehouse")).toBeInTheDocument();
    // Profile attribution renders on the card that references it.
    expect(screen.getByText(/Office tunnel \(ssh-tunnel\)/)).toBeInTheDocument();
    expect(screen.getByText(/Direct connection/)).toBeInTheDocument();

    // 2 cards × 2 switches (the profiles board lives in a dialog now), each
    // labelled by id.
    expect(screen.getAllByRole("switch")).toHaveLength(4);
    expect(document.getElementById("tab-c1")).not.toBeNull();
    expect(document.getElementById("ai-c1")).not.toBeNull();
  });

  it("flips Enabled for AI through the flag command", async () => {
    const user = userEvent.setup();
    renderOverview();

    await screen.findByText("Sales MySQL");
    // Radix Switch renders the button with the labelled id itself.
    const aiSwitch = document.getElementById("ai-c1");
    expect(aiSwitch).not.toBeNull();
    expect(aiSwitch!.getAttribute("role")).toBe("switch");
    await user.click(aiSwitch!);

    await waitFor(() => {
      expect(setConnectionFlags).toHaveBeenCalledWith(
        "c1",
        { enabledForAi: true }
      );
    });
  });

  it("opens the network profiles master-detail board from the toolbar icon", async () => {
    const user = userEvent.setup();
    renderOverview();

    // The board is an entry, not a fixture: hidden until the icon opens it.
    expect(screen.queryByText("SSH Tunnel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Manage Network Profiles" }));

    expect(await screen.findByText("SSH Tunnel")).toBeInTheDocument();
    expect(screen.getByText("Proxy")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10.20.30.40")).toBeInTheDocument();
    expect(screen.getByDisplayValue("root")).toBeInTheDocument();
  });

  it("deletes a connection after confirming", async () => {
    const user = userEvent.setup();
    renderOverview();

    await user.click(await screen.findByRole("button", { name: "Delete Sales MySQL" }));
    expect(await screen.findByText("Delete connection?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete connection" }));

    await waitFor(() => expect(deleteConnection).toHaveBeenCalledWith("c1"));
  });

  it("refuses to delete a profile still bound to a connection", async () => {
    const user = userEvent.setup();
    renderOverview();

    await user.click(screen.getByRole("button", { name: "Manage Network Profiles" }));
    // p1 "Office tunnel" is bound to c2 "Warehouse" in the mock. The row also
    // carries its transport tag, so its accessible name is "Office tunnel SSH".
    await user.click(await screen.findByRole("button", { name: /^Office tunnel/ }));
    await user.click(screen.getByRole("button", { name: "Delete profile" }));

    expect(await screen.findByText("Profile is in use")).toBeInTheDocument();
    expect(screen.getByText(/still bound to 1 connection/)).toBeInTheDocument();
    // "Warehouse" also appears on its connection card behind the dialog — the
    // list inside the dialog is what matters.
    expect(screen.getAllByText("Warehouse").length).toBeGreaterThan(0);
    expect(deleteProfile).not.toHaveBeenCalled();
  });

  it("tags each profile with its transport and renames it on double-click", async () => {
    const user = userEvent.setup();
    renderOverview();

    await user.click(screen.getByRole("button", { name: "Manage Network Profiles" }));
    const row = await screen.findByRole("button", { name: /^Office tunnel/ });
    expect(within(row).getByText("SSH")).toBeInTheDocument();

    await user.dblClick(row);
    const input = screen.getByLabelText("Profile name");
    await user.clear(input);
    await user.type(input, "Bastion{Enter}");

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith(
        // The whole profile goes back: the command upserts every field, so a
        // rename that omitted `enabled` would disable the thing it renamed.
        expect.objectContaining({
          id: "p1",
          name: "Bastion",
          enabled: true,
          transport: expect.objectContaining({ type: "ssh-tunnel" })
        })
      );
    });
  });
});
