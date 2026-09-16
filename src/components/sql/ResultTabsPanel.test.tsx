import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResultTabsPanel } from "./ResultTabsPanel";

const tabs = [
  { id: "t1", title: "orders", tooltip: "SELECT * FROM orders" },
  { id: "t2", title: "Result 2", running: true }
];

function renderStrip(overrides: Partial<Parameters<typeof ResultTabsPanel<typeof tabs[number]>>[0]> = {}) {
  const onSelectTab = vi.fn();
  const onCloseTab = vi.fn();
  render(
    <ResultTabsPanel
      tabs={tabs}
      activeTabId="t1"
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      {...overrides}
    >
      {(activeTab) => <p>body of {activeTab.title}</p>}
    </ResultTabsPanel>
  );
  return { onSelectTab, onCloseTab };
}

describe("ResultTabsPanel", () => {
  it("renders the strip and the active tab's body", () => {
    renderStrip();

    expect(screen.getByRole("button", { name: "orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "● Result 2" })).toBeInTheDocument();
    // The strip owns the active-tab lookup, so the caller never duplicates it.
    expect(screen.getByText("body of orders")).toBeInTheDocument();
  });

  it("marks a running tab that is not the one on screen", () => {
    renderStrip();

    expect(screen.getByRole("button", { name: "● Result 2" })).toBeInTheDocument();
  });

  it("offers a close button per tab and reports which one", async () => {
    const user = userEvent.setup();
    const { onCloseTab } = renderStrip();

    await user.click(screen.getByRole("button", { name: "Close Result 2" }));

    expect(onCloseTab).toHaveBeenCalledWith("t2");
  });

  it("hides the close button when there is nothing left to close to", () => {
    renderStrip({ tabs: [tabs[0]] });

    expect(screen.queryByRole("button", { name: /^Close / })).not.toBeInTheDocument();
  });

  it("switches tabs by id", async () => {
    const user = userEvent.setup();
    const { onSelectTab } = renderStrip();

    await user.click(screen.getByRole("button", { name: "● Result 2" }));

    expect(onSelectTab).toHaveBeenCalledWith("t2");
  });

  it("shows the empty label when there are no tabs at all", () => {
    renderStrip({ tabs: [] });

    expect(screen.getByText("No result tabs.")).toBeInTheDocument();
  });
});
