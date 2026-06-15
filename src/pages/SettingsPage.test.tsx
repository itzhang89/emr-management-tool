import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
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
  useAwsAccounts: () => ({ data: [], isLoading: false, error: null }),
  useAwsCliProfiles: () => ({ data: [], isLoading: false, error: null }),
  useCreateAwsAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAwsAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useImportAwsCliProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useSetActiveAwsAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useTestAwsCredentials: () => ({ mutateAsync: vi.fn(), isPending: false })
}));

describe("SettingsPage updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows why automatic updates are unavailable for the current build", async () => {
    const user = userEvent.setup();
    mocks.checkForUpdate.mockResolvedValue({
      status: "unavailable",
      reason: "Automatic updates are currently available only for Windows stable builds."
    });

    render(<SettingsPage />);
    await user.click(screen.getByRole("button", { name: /Check for Updates/i }));

    expect(mocks.checkForUpdate).toHaveBeenCalledOnce();
    expect(mocks.toastInfo).toHaveBeenCalledWith("Automatic updates are currently available only for Windows stable builds.");
  });

  it("lets the user install an available update", async () => {
    const user = userEvent.setup();
    const install = vi.fn().mockResolvedValue(undefined);
    mocks.checkForUpdate.mockResolvedValue({
      status: "available",
      version: "0.2.0",
      notes: "Bug fixes",
      install
    });

    render(<SettingsPage />);
    await user.click(screen.getByRole("button", { name: /Check for Updates/i }));
    await user.click(screen.getByRole("button", { name: /Install 0.2.0/i }));

    expect(screen.getByText("Version 0.2.0 is available.")).toBeInTheDocument();
    expect(install).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Update installed. Restart the app to use the new version.");
  });
});
