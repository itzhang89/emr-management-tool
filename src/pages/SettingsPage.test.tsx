import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsPage } from "./SettingsPage";

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  setActiveMutate: vi.fn(),
  deleteMutate: vi.fn(),
  createMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
  importMutate: vi.fn(),
  loadMutateAsync: vi.fn(),
  accounts: [
    {
      id: "acct-1",
      name: "prod",
      region: "us-east-1",
      accessKeyIdMasked: "AKIA****",
      isActive: true
    },
    {
      id: "acct-2",
      name: "staging",
      region: "eu-west-1",
      accessKeyIdMasked: "AKIB****",
      isActive: false
    }
  ],
  cliProfiles: [
    {
      profileName: "ready-profile",
      region: "ap-southeast-1",
      accessKeyIdMasked: "AKIA****READY",
      canImport: true
    },
    {
      profileName: "prod",
      region: "eu-central-1",
      accessKeyIdMasked: "AKIA****DUP",
      canImport: true
    },
    {
      profileName: "no-region",
      region: undefined,
      accessKeyIdMasked: "AKIA****NONE",
      canImport: true
    }
  ]
}));

vi.mock("@/services/appUpdater", () => ({
  appUpdater: { checkForUpdate: mocks.checkForUpdate }
}));

vi.mock("sonner", () => ({
  toast: {
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
    error: mocks.toastError
  }
}));

vi.mock("@/hooks/useAwsSettings", () => ({
  useAwsAccounts: () => ({ data: mocks.accounts, isLoading: false, error: null }),
  useAwsCliProfiles: () => ({ data: mocks.cliProfiles, isLoading: false, error: null }),
  useCreateAwsAccount: () => ({ mutateAsync: mocks.createMutateAsync, isPending: false }),
  useUpdateAwsAccount: () => ({ mutateAsync: mocks.updateMutateAsync, isPending: false }),
  useDeleteAwsAccount: () => ({ mutate: mocks.deleteMutate, isPending: false }),
  useImportAwsCliProfile: () => ({ mutate: mocks.importMutate, isPending: false }),
  useLoadAwsCliProfile: () => ({ mutateAsync: mocks.loadMutateAsync, isPending: false }),
  useSetActiveAwsAccount: () => ({ mutate: mocks.setActiveMutate, isPending: false }),
  useTestAwsCredentials: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestAwsAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActiveAwsAccount: () => ({ data: mocks.accounts[0], isLoading: false, error: null })
}));

describe("SettingsPage updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts[0] = {
      id: "acct-1",
      name: "prod",
      region: "us-east-1",
      accessKeyIdMasked: "AKIA****",
      isActive: true
    };
    mocks.accounts[1] = {
      id: "acct-2",
      name: "staging",
      region: "eu-west-1",
      accessKeyIdMasked: "AKIB****",
      isActive: false
    };
    mocks.loadMutateAsync.mockResolvedValue({
      profileName: "no-region",
      accessKeyId: "AKIANONE",
      secretAccessKey: "secret-none",
      region: undefined
    });
  });

  it("shows why automatic updates are unavailable for the current build", async () => {
    const user = userEvent.setup();
    mocks.checkForUpdate.mockResolvedValue({
      status: "unavailable",
      reason: "Automatic updates are currently available only for Windows stable builds."
    });

    renderSettingsPage();
    await user.click(screen.getByRole("button", { name: /Check for Updates/i }));

    expect(mocks.checkForUpdate).toHaveBeenCalledOnce();
    expect(mocks.toastInfo).toHaveBeenCalledWith("Automatic updates are currently available only for Windows stable builds.");
  });

  it("renders update guidance as a tooltip on a single update button", async () => {
    const user = userEvent.setup();
    mocks.checkForUpdate.mockResolvedValue({ status: "no-update" });

    renderSettingsPage();

    expect(screen.queryByRole("heading", { name: "Application Updates" })).not.toBeInTheDocument();
    expect(screen.getByText(/Current version:/i)).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: /Check for Updates/i }));

    expect(await screen.findAllByText("Stable · Manual updates only")).not.toHaveLength(0);
  });

  it("lets the user install an available update from the update button", async () => {
    const user = userEvent.setup();
    const install = vi.fn().mockResolvedValue(undefined);
    mocks.checkForUpdate.mockResolvedValue({
      status: "available",
      version: "0.2.0",
      notes: "Bug fixes",
      install
    });

    renderSettingsPage();
    await user.click(screen.getByRole("button", { name: /Check for Updates/i }));

    expect(screen.getByText(/Current version:/i)).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to/i)).toBeInTheDocument();
    expect(screen.getByText("0.2.0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Install 0.2.0/i }));

    expect(install).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Update installed. Restart the app to use the new version.");
  });

  it("opens the add-account dialog from the + button with an empty region by default", async () => {
    const user = userEvent.setup();

    renderSettingsPage();
    expect(screen.queryByRole("heading", { name: "AWS Credentials" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add account/i }));
    expect(screen.getByRole("heading", { name: "Add AWS Account" })).toBeInTheDocument();

    const regionInput = screen.getByPlaceholderText("eu-central-1");
    expect(regionInput).toHaveValue("");
    await user.type(regionInput, "ap-south-1");
    expect(regionInput).toHaveValue("ap-south-1");
  });

  it("lets the user reveal the secret access key while adding an account", async () => {
    const user = userEvent.setup();

    renderSettingsPage();
    await user.click(screen.getByRole("button", { name: /Add account/i }));

    const dialog = screen.getByRole("dialog");
    const secretInput = within(dialog).getByPlaceholderText("••••••••••••••••");
    await user.type(secretInput, "super-secret");
    expect(secretInput).toHaveAttribute("type", "password");

    await user.click(within(dialog).getByRole("button", { name: /Show secret access key/i }));
    expect(secretInput).toHaveAttribute("type", "text");
    expect(secretInput).toHaveValue("super-secret");

    await user.click(within(dialog).getByRole("button", { name: /Hide secret access key/i }));
    expect(secretInput).toHaveAttribute("type", "password");
  });

  it("switches the active account on double-click", async () => {
    const user = userEvent.setup();

    renderSettingsPage();
    await user.dblClick(screen.getByText("staging"));

    expect(mocks.setActiveMutate).toHaveBeenCalledWith("acct-2", expect.any(Object));
  });

  it("opens edit dialog with read-only access key and masked secret", async () => {
    const user = userEvent.setup();

    renderSettingsPage();
    await user.click(screen.getAllByRole("button", { name: /Edit/i })[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit AWS Account" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Access Key ID \(read-only\)/i)).toHaveValue("AKIA****");
    expect(within(dialog).getByLabelText(/Secret Access Key \(masked\)/i)).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /^Change$/i })).toBeInTheDocument();
  });

  it("asks for confirmation before deleting an account", async () => {
    const user = userEvent.setup();

    renderSettingsPage();
    await user.click(screen.getAllByRole("button", { name: /Delete/i })[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /Delete AWS account/i })).toBeInTheDocument();
    expect(mocks.deleteMutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
    expect(mocks.deleteMutate).toHaveBeenCalledWith("acct-1", expect.any(Object));
  });

  it("imports a complete CLI profile directly", async () => {
    const user = userEvent.setup();

    renderSettingsPage();
    const importButtons = screen.getAllByRole("button", { name: /Import/i });
    await user.click(importButtons[0]);

    expect(mocks.importMutate).toHaveBeenCalledWith(
      {
        profileName: "ready-profile",
        name: "ready-profile",
        region: "ap-southeast-1",
        makeActive: true
      },
      expect.any(Object)
    );
    expect(mocks.loadMutateAsync).not.toHaveBeenCalled();
  });

  it("opens the add form when importing a duplicate-named CLI profile", async () => {
    const user = userEvent.setup();
    mocks.loadMutateAsync.mockResolvedValue({
      profileName: "prod",
      accessKeyId: "AKIADUP",
      secretAccessKey: "secret-dup",
      region: "eu-central-1"
    });

    renderSettingsPage();
    const importButtons = screen.getAllByRole("button", { name: /Import/i });
    await user.click(importButtons[1]);

    expect(mocks.loadMutateAsync).toHaveBeenCalledWith("prod");
    expect(mocks.importMutate).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Import AWS CLI Profile" })).toBeInTheDocument();
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("AKIADUP")).toBeInTheDocument();
    expect(screen.getByDisplayValue("eu-central-1")).toBeInTheDocument();
  });

  it("opens the add form when importing a CLI profile without a region", async () => {
    const user = userEvent.setup();

    renderSettingsPage();
    const importButtons = screen.getAllByRole("button", { name: /Import/i });
    await user.click(importButtons[2]);

    expect(mocks.loadMutateAsync).toHaveBeenCalledWith("no-region");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Import AWS CLI Profile" })).toBeInTheDocument();
    expect(within(dialog).getByText(/This profile has no region/i)).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("AKIANONE")).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("eu-central-1")).toHaveValue("");
  });
});

function renderSettingsPage() {
  return render(
    <TooltipProvider>
      <SettingsPage />
    </TooltipProvider>
  );
}
