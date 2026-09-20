import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const createConnection = vi.fn().mockResolvedValue({
  id: "new-1",
  accountId: "acct-a",
  kind: "mysql",
  name: "Sales MySQL",
  host: "10.0.0.1",
  port: 3306,
  username: "bi_reader",
  showAsTab: true,
  enabledForAi: true,
  aiReadOnlyPolicy: "select-only",
  allowWrites: false,
  authMode: "manual" as const,
  sortOrder: 0
});
// Echo the id back the way the command does — a test that follows a create
// with an update reads the id the second call actually used.
const updateConnection = vi.fn().mockImplementation((input: { id: string }) =>
  Promise.resolve({ id: input.id })
);
const testDraftConnection = vi.fn().mockResolvedValue({
  ok: true,
  message: "Connected. Server: 8.0.36",
  latencyMs: 12
});

vi.mock("@/services/tauriClient", () => ({
  tauriClient: {
    listDbConnections: vi.fn().mockResolvedValue([]),
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
    createDbConnection: (...args: unknown[]) => createConnection(...args),
    updateDbConnection: (...args: unknown[]) => updateConnection(...args),
    testDbConnectionDraft: (...args: unknown[]) => testDraftConnection(...args),
    listSecrets: vi.fn().mockResolvedValue([])
  }
}));

vi.mock("@/hooks/useAwsSettings", () => ({
  useAwsAccounts: () => ({ data: [], isLoading: false }),
  useActiveAwsAccount: () => ({ data: { id: "acct-a", name: "Test", region: "us-east-1" } }),
  useSetActiveAwsAccount: () => ({ mutate: vi.fn(), isPending: false })
}));

function renderDialog(props: Partial<Parameters<typeof ConnectionFormDialog>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConnectionFormDialog
          open
          onOpenChange={onOpenChange}
          onSaved={onSaved}
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { onOpenChange, onSaved };
}

function fillRequiredFields() {
  return userEvent
    .type(screen.getByLabelText("Name"), "Sales MySQL")
    .then(() => userEvent.type(screen.getByLabelText("Server Host"), "10.0.0.1"))
    .then(() => userEvent.type(screen.getByLabelText("Username"), "bi_reader"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ConnectionFormDialog", () => {
  it("creates a connection from the Server/Authentication groups", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSaved } = renderDialog();

    await fillRequiredFields();
    await user.click(screen.getByRole("checkbox", { name: /Show as tab/ }));

    await user.click(screen.getByRole("button", { name: "Save and Close" }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "mysql",
          name: "Sales MySQL",
          host: "10.0.0.1",
          port: 3306,
          username: "bi_reader",
          showAsTab: true,
          enabledForAi: true
        })
      );
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("rejects a missing host with a validation toast and no command", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Name"), "No host");
    await user.type(screen.getByLabelText("Username"), "bi_reader");
    await user.click(screen.getByRole("button", { name: "Save and Close" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Server host is required.");
    });
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("probes the form's values and writes nothing", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog();

    await fillRequiredFields();
    await user.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() => {
      expect(testDraftConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "mysql",
          host: "10.0.0.1",
          port: 3306,
          username: "bi_reader"
        })
      );
    });
    // Test is a read-only act from the user's side: no row, no refresh.
    expect(createConnection).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Connected"));
    });
  });

  it("keeps testing without queueing up connections", async () => {
    const user = userEvent.setup();
    renderDialog();

    await fillRequiredFields();
    await user.click(screen.getByRole("button", { name: "Test Connection" }));
    await waitFor(() => expect(testDraftConnection).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Test Connection" }));
    await user.click(screen.getByRole("button", { name: "Test Connection" }));
    await waitFor(() => expect(testDraftConnection).toHaveBeenCalledTimes(3));

    // ...and the Save that follows is the only write this dialog makes.
    await user.click(screen.getByRole("button", { name: "Save and Close" }));
    await waitFor(() => expect(createConnection).toHaveBeenCalledTimes(1));
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it("hands the edited connection's id to the probe so a blank password can reuse the stored secret", async () => {
    const user = userEvent.setup();
    renderDialog({
      connection: {
        id: "c1",
        accountId: "acct-a",
        kind: "postgres",
        name: "Warehouse",
        host: "10.0.0.2",
        port: 5432,
        username: "reader",
        showAsTab: false,
        enabledForAi: true,
        aiReadOnlyPolicy: "select-only",
        allowWrites: false,
        authMode: "manual",
        sortOrder: 0,
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z"
      }
    });

    await user.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() => {
      expect(testDraftConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: "c1", host: "10.0.0.2", port: 5432 })
      );
    });
    // Editing and testing still writes nothing.
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it("lists network profiles in the routing picker", async () => {
    renderDialog();

    const option = await screen.findByRole("option", { name: /Office tunnel \(SSH\)/ });
    expect(option).toBeInTheDocument();
  });

  it("keeps the stored password masked in edit mode and omits blank passwords", async () => {
    const user = userEvent.setup();
    renderDialog({
      connection: {
        id: "c1",
        accountId: "acct-a",
        kind: "postgres",
        name: "Warehouse",
        host: "10.0.0.2",
        port: 5432,
        username: "reader",
        showAsTab: false,
        enabledForAi: true,
        aiReadOnlyPolicy: "select-only",
        allowWrites: false,
        authMode: "manual",
        sortOrder: 0,
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z"
      }
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: "c1", name: "Warehouse", port: 5432 })
      );
    });
    // No password typed → the update payload's password is undefined, so the
    // stored secret is untouched.
    expect(updateConnection.mock.calls[0][0].password).toBeUndefined();
  });
});
