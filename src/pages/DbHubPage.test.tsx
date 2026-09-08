import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DbHubPage } from "./DbHubPage";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderDbHubPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DbHubPage />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

// GlueCatalogTab reaches for AWS through react-query; without a Tauri runtime
// those queries fail with the demo-mode error. Silence the console noise and
// let the tab render its idle/empty states.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("DbHubPage", () => {
  it("opens on the Overview tab with the two fixed tabs present", async () => {
    renderDbHubPage();

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.getByRole("tab", { name: "Glue Catalog" })).toBeInTheDocument();
    expect(screen.getByText("DBHub Overview")).toBeInTheDocument();
  });

  it("shows the Glue Catalog workspace when its tab is activated", async () => {
    const user = userEvent.setup();
    renderDbHubPage();

    await user.click(screen.getByRole("tab", { name: "Glue Catalog" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Glue Catalog" })).toHaveAttribute(
        "data-state",
        "active"
      );
    });
  });

  it("keeps the workspace mounted when switching away and back", async () => {
    const user = userEvent.setup();
    renderDbHubPage();

    await user.click(screen.getByRole("tab", { name: "Glue Catalog" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Glue Catalog" })).toHaveAttribute(
        "data-state",
        "active"
      );
    });

    // The workspace marks its catalog tree button; grab a stable element that
    // only exists once the workspace has mounted.
    const runButton = await screen.findByRole("button", { name: "Run query" });
    expect(runButton).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByText("DBHub Overview")).toBeInTheDocument();

    // Same element instance → the workspace was never unmounted.
    await user.click(screen.getByRole("tab", { name: "Glue Catalog" }));
    expect(screen.getByRole("button", { name: "Run query" })).toBe(runButton);
  });

  it("does not mount the workspace until its tab is first activated", () => {
    renderDbHubPage();

    expect(screen.queryByRole("button", { name: "Run query" })).not.toBeInTheDocument();
  });
});
