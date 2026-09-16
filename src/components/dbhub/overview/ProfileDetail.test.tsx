import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { NetworkProfile } from "@/types/domain";
import { ProfileDetail } from "./ProfileDetail";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const saveProfile = vi.fn().mockResolvedValue({ id: "p1" });
const testProfile = vi.fn().mockResolvedValue({ ok: true, message: "ok", latencyMs: 3 });
const deleteProfile = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/tauriClient", () => ({
  tauriClient: {
    listNetworkProfiles: vi.fn().mockResolvedValue([]),
    saveNetworkProfile: (...args: unknown[]) => saveProfile(...args),
    testNetworkProfile: (...args: unknown[]) => testProfile(...args),
    deleteNetworkProfile: (...args: unknown[]) => deleteProfile(...args)
  }
}));

vi.mock("@/hooks/useAwsSettings", () => ({
  useAwsAccounts: () => ({ data: [], isLoading: false }),
  useActiveAwsAccount: () => ({ data: { id: "acct-a", name: "Test", region: "us-east-1" } }),
  useSetActiveAwsAccount: () => ({ mutate: vi.fn(), isPending: false })
}));

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const profile: NetworkProfile = {
    id: "p1",
    accountId: "acct-a",
    name: "Office tunnel",
    transport: {
      type: "ssh-tunnel",
      host: "10.20.30.40",
      port: 22,
      username: "root",
      authMethod: "password",
      credentialsSaved: false
    },
    enabled: true,
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z"
  };
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ProfileDetail profile={profile} />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return profile;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ProfileDetail", () => {
  it("switches auth to private-key and reveals the key path field", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.selectOptions(screen.getByLabelText("Authentication"), "private-key");

    // The key file row appears; the host label stays "Host/IP".
    expect(await screen.findByLabelText("Key file")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Key file"), "~/.ssh/id_ed25519");
    await user.type(screen.getByLabelText("Key passphrase"), "phrase");

    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            authMethod: "private-key",
            privateKeyPath: "~/.ssh/id_ed25519"
          }),
          secret: "phrase"
        })
      );
    });
  });

  it("switches auth to ssh-config and sends the alias as host", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.selectOptions(screen.getByLabelText("Authentication"), "ssh-config");

    expect(await screen.findByText(/Alias mode reads/)).toBeInTheDocument();
    // User and key-path are ignored in alias mode.
    expect(screen.getByLabelText("User Name")).toBeDisabled();

    await user.type(screen.getByLabelText("SSH config alias"), "bastion-prod");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            authMethod: "ssh-config",
            host: "bastion-prod"
          })
        })
      );
    });
  });

  it("keeps each transport's fields when switching tabs", async () => {
    const user = userEvent.setup();
    renderProfile();

    // The profile is an SSH one; peeking at Proxy and coming back must not
    // cost the host that was already there.
    await user.click(screen.getByRole("tab", { name: "Proxy" }));
    await user.clear(screen.getByLabelText("Host"));
    await user.type(screen.getByLabelText("Host"), "127.0.0.1");
    await user.click(screen.getByRole("tab", { name: "SSH Tunnel" }));

    expect(screen.getByLabelText("Host/IP")).toHaveValue("10.20.30.40");
  });

  it("hands the profile to the other transport when that tab's switch goes on", async () => {
    const user = userEvent.setup();
    renderProfile();

    // The profile is an SSH one, so that is the tab in use and the switch —
    // which shows the tab you are looking at — is on.
    expect(within(screen.getByRole("tab", { name: "SSH Tunnel" })).getByText("active")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();

    await user.click(screen.getByRole("tab", { name: "Proxy" }));
    // Same switch, other tab: it now shows Proxy's state, which is off.
    expect(screen.getByRole("switch")).not.toBeChecked();

    await user.clear(screen.getByLabelText("Host"));
    await user.type(screen.getByLabelText("Host"), "10.0.0.9");
    // Typing alone does not hand the profile over; the switch does.
    expect(screen.getByRole("switch")).not.toBeChecked();
    await user.click(screen.getByRole("switch"));
    expect(within(screen.getByRole("tab", { name: "Proxy" })).getByText("active")).toBeInTheDocument();

    // ...and the tab it left is no longer in use.
    await user.click(screen.getByRole("tab", { name: "SSH Tunnel" }));
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(within(screen.getByRole("tab", { name: "SSH Tunnel" })).queryByText("active")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          transport: expect.objectContaining({ type: "socks5", host: "10.0.0.9" })
        })
      );
    });
  });

  it("tests the working copy by saving it first (no stale 'disabled' trap)", async () => {
    const user = userEvent.setup();
    renderProfile();

    // Toggle enabled off, then test — the save must happen before the probe.
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Test tunnel configuration" }));

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });
    await waitFor(() => {
      expect(testProfile).toHaveBeenCalledWith("p1");
    });
  });
});
