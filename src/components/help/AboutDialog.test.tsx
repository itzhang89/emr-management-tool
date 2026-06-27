import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";

vi.mock("@/services/appUpdater", () => ({
  appUpdater: { checkForUpdate: vi.fn() }
}));

describe("AboutDialog", () => {
  it("renders app version details", () => {
    render(<AboutDialog open onOpenChange={() => {}} />);

    expect(screen.getByRole("dialog", { name: /EMR on EKS Management Tool/i })).toBeInTheDocument();
    expect(screen.getByText(/Version:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check for updates/i })).toBeInTheDocument();
  });
});
