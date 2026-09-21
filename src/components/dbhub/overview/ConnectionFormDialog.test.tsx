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
// Hoisted: the tauriClient mock below is hoisted above these declarations, so
// anything its factory reads at call time has to be created with it.
const { SALES_ARN } = vi.hoisted(() => ({
  SALES_ARN: "arn:aws:secretsmanager:us-east-1:123:secret:mysql.sales"
}));
const getSecretValue = vi.fn().mockResolvedValue({
  value: JSON.stringify({
    username: "bi",
    password: "s3cret",
    host: "db.internal",
    port: 3307,
    database: "sales"
  })
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
    listSecrets: vi.fn().mockResolvedValue([
      { name: "mysql.sales", arn: SALES_ARN, description: undefined, tags: [] }
    ]),
    getSecretValue: (...args: unknown[]) => getSecretValue(...args),
    createSecret: vi.fn().mockResolvedValue({
      name: "mysql.sales",
      arn: "arn:aws:secretsmanager:us-east-1:123:secret:mysql.sales",
      tags: []
    })
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

/** Every dial field but the database — a new connection requires all four. */
function fillRequiredFields() {
  return userEvent
    .type(screen.getByLabelText("Name"), "Sales MySQL")
    .then(() => userEvent.type(screen.getByLabelText("Server Host"), "10.0.0.1"))
    .then(() => userEvent.type(screen.getByLabelText("Username"), "bi_reader"))
    .then(() => userEvent.type(screen.getByLabelText("Password"), "s3cret"));
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

  it("locks the fields the secret owns and saves what it supplies", async () => {
    const user = userEvent.setup();
    renderDialog();

    await fillRequiredFields();
    await user.click(screen.getByRole("radio", { name: "AWS Secrets Manager" }));
    await user.selectOptions(await screen.findByLabelText("Secret"), SALES_ARN);

    await waitFor(() => {
      expect(getSecretValue).toHaveBeenCalledWith(SALES_ARN);
    });

    // The fields keep their place in the form, holding the secret's values and
    // refusing edits rather than disappearing.
    await waitFor(() => {
      expect(screen.getByLabelText("Server Host")).toBeDisabled();
    });
    expect(screen.getByLabelText("Server Host")).toHaveValue("db.internal");
    expect(screen.getByLabelText("Port")).toHaveValue(3307);
    expect(screen.getByLabelText(/^Database/)).toHaveValue("sales");
    expect(screen.getByLabelText("Username")).toHaveValue("bi");
    // The password's value stays in Secrets Manager: the field is locked empty.
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toHaveValue("");

    // What the secret holds is what gets saved, so the card describes the real
    // server rather than whatever was typed before the secret was chosen.
    await user.click(screen.getByRole("button", { name: "Save and Close" }));
    await waitFor(() => {
      expect(createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          authMode: "aws_secret",
          secretArn: SALES_ARN,
          host: "db.internal",
          port: 3307,
          username: "bi",
          database: "sales"
        })
      );
    });
    expect(createConnection.mock.calls[0][0].password).toBeUndefined();
  });

  it("leaves a field the secret omits editable, and requires it", async () => {
    const user = userEvent.setup();
    getSecretValue.mockResolvedValueOnce({ value: JSON.stringify({ password: "only" }) });
    renderDialog();

    await user.type(screen.getByLabelText("Name"), "Secret only");
    await user.click(screen.getByRole("radio", { name: "AWS Secrets Manager" }));
    await user.selectOptions(await screen.findByLabelText("Secret"), SALES_ARN);

    // Only the password is locked — the other four are the user's to fill.
    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toBeDisabled();
    });
    expect(screen.getByLabelText("Server Host")).toBeEnabled();
    expect(screen.getByLabelText("Username")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Save and Close" }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Server host is required — the bound secret does not provide one."
      );
    });
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("takes a password the secret does not carry, and keeps it locally", async () => {
    const user = userEvent.setup();
    getSecretValue.mockResolvedValueOnce({
      value: JSON.stringify({ host: "db.internal", port: 3306, username: "bi" })
    });
    renderDialog();

    await user.type(screen.getByLabelText("Name"), "No password");
    await user.click(screen.getByRole("radio", { name: "AWS Secrets Manager" }));
    await user.selectOptions(await screen.findByLabelText("Secret"), SALES_ARN);

    // The password is the one field the secret cannot cover here, so the form
    // asks for it and the stored copy backs the secret up at dial time.
    await waitFor(() => {
      expect(screen.getByLabelText("Server Host")).toBeDisabled();
    });
    expect(screen.getByLabelText("Password")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Save and Close" }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Password is required — the bound secret does not provide one."
      );
    });

    await user.type(screen.getByLabelText("Password"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Save and Close" }));
    await waitFor(() => {
      expect(createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          authMode: "aws_secret",
          secretArn: SALES_ARN,
          host: "db.internal",
          password: "s3cret"
        })
      );
    });
  });

  it("requires the four dial fields of a manual connection, database aside", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Name"), "No password");
    await user.type(screen.getByLabelText("Server Host"), "10.0.0.1");
    await user.type(screen.getByLabelText("Username"), "bi_reader");
    await user.click(screen.getByRole("button", { name: "Save and Close" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Password is required.");
    });
    expect(createConnection).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Password"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Save and Close" }));
    // No database typed, and none is asked for.
    await waitFor(() => {
      expect(createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ host: "10.0.0.1", username: "bi_reader", password: "s3cret" })
      );
    });
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
