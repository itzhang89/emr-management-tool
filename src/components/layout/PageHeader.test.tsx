import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the page title and navigation description", () => {
    render(<PageHeader pageId="history" />);

    expect(screen.getByRole("heading", { name: "Job History" })).toBeInTheDocument();
    expect(screen.getByText("Track and clone jobs")).toBeInTheDocument();
  });

  it("renders optional title addons and actions", () => {
    render(
      <PageHeader
        pageId="settings"
        titleAddon={<span>Development</span>}
        actions={<button type="button">Check for Updates</button>}
      />
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("AWS credentials")).toBeInTheDocument();
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeInTheDocument();
  });
});
