import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CatalogToolbar } from "./CatalogToolbar";

function renderToolbar(overrides: Partial<Parameters<typeof CatalogToolbar>[0]> = {}) {
  const onRefresh = vi.fn();
  const onFilterChange = vi.fn();
  const onBack = vi.fn();
  const onCollapse = vi.fn();
  render(
    <TooltipProvider>
      <CatalogToolbar
        // The back button needs both a destination and a name, so the handler
        // is always wired here — the label is what decides whether it shows.
        onBack={onBack}
        filter=""
        onFilterChange={onFilterChange}
        filterPlaceholder="Filter databases"
        onRefresh={onRefresh}
        refreshing={false}
        {...overrides}
      />
    </TooltipProvider>
  );
  return { onRefresh, onFilterChange, onBack, onCollapse };
}

describe("CatalogToolbar", () => {
  it("omits the back button when there is nowhere to go back to", () => {
    renderToolbar();

    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
  });

  it("offers the back button, under its own label, when given one", async () => {
    const user = userEvent.setup();
    const toolbar = renderToolbar({ backLabel: "Back one level" });

    await user.click(screen.getByRole("button", { name: "Back one level" }));

    expect(toolbar.onBack).toHaveBeenCalled();
  });

  it("reports what was typed into the filter", async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderToolbar();

    await user.type(screen.getByPlaceholderText("Filter databases"), "sal");

    expect(onFilterChange).toHaveBeenCalled();
  });

  it("refetches from the refresh button", async () => {
    const user = userEvent.setup();
    const { onRefresh } = renderToolbar();

    await user.click(screen.getByRole("button", { name: "Refresh catalog" }));

    expect(onRefresh).toHaveBeenCalled();
  });

  it("only offers collapse when the panel can be hidden", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TooltipProvider>
        <CatalogToolbar
          filter=""
          onFilterChange={vi.fn()}
          filterPlaceholder="Filter databases"
          onRefresh={vi.fn()}
          refreshing={false}
        />
      </TooltipProvider>
    );
    // No handler → no button inviting a click that does nothing.
    expect(screen.queryByRole("button", { name: "Collapse catalog panel" })).not.toBeInTheDocument();

    const onCollapse = vi.fn();
    rerender(
      <TooltipProvider>
        <CatalogToolbar
          filter=""
          onFilterChange={vi.fn()}
          filterPlaceholder="Filter databases"
          onRefresh={vi.fn()}
          refreshing={false}
          onCollapse={onCollapse}
          collapseShortcut="⌘\"
        />
      </TooltipProvider>
    );
    await user.click(screen.getByRole("button", { name: "Collapse catalog panel" }));

    expect(onCollapse).toHaveBeenCalled();
  });
});
