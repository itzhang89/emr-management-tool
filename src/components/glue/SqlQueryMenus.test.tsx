import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  FavoriteNameDialog,
  FavoritesMenu,
  HistoryMenu
} from "@/components/glue/SqlQueryMenus";
import type { ReactElement } from "react";
import type { SqlFavoriteEntry, SqlHistoryEntry } from "@/types/domain";

const historyEntry: SqlHistoryEntry = {
  id: "history-1",
  sql: "SELECT * FROM reports;",
  submittedAt: "2026-06-27T10:00:00.000Z"
};

const favoriteEntry: SqlFavoriteEntry = {
  id: "favorite-1",
  name: "Daily report",
  sql: "SELECT * FROM reports;",
  createdAt: "2026-06-27T10:00:00.000Z"
};

function renderWithTooltip(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("SqlQueryMenus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onFavorite from history when star is clicked", async () => {
    const user = userEvent.setup();
    const onFavorite = vi.fn();

    renderWithTooltip(
      <HistoryMenu
        history={[historyEntry]}
        favoriteSqlSet={new Set()}
        onSelect={vi.fn()}
        onFavorite={onFavorite}
      />
    );

    await user.click(screen.getByRole("button", { name: "Query history" }));
    await user.click(screen.getByRole("button", { name: "Add to favorites" }));

    expect(onFavorite).toHaveBeenCalledWith(historyEntry);
  });

  it("disables favorite star when sql is already saved", async () => {
    const user = userEvent.setup();

    renderWithTooltip(
      <HistoryMenu
        history={[historyEntry]}
        favoriteSqlSet={new Set(["SELECT * FROM reports;"])}
        onSelect={vi.fn()}
        onFavorite={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Query history" }));

    expect(screen.getByRole("button", { name: "Already in favorites" })).toBeDisabled();
  });

  it("loads a favorite and removes it from the favorites menu", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRemove = vi.fn();

    renderWithTooltip(
      <FavoritesMenu favorites={[favoriteEntry]} onSelect={onSelect} onRemove={onRemove} />
    );

    await user.click(screen.getByRole("button", { name: "Saved favorites" }));

    await user.click(screen.getByRole("button", { name: "Daily report" }));
    expect(onSelect).toHaveBeenCalledWith(favoriteEntry);

    await user.click(screen.getByRole("button", { name: "Saved favorites" }));
    await user.click(screen.getByRole("button", { name: "Remove Daily report" }));
    expect(onRemove).toHaveBeenCalledWith("favorite-1");
  });

  it("saves a favorite name from the dialog", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    renderWithTooltip(
      <FavoriteNameDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} defaultName="Saved query" />
    );

    const input = screen.getByLabelText("Favorite name");
    await user.clear(input);
    await user.type(input, "Weekly rollup");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onConfirm).toHaveBeenCalledWith("Weekly rollup");
  });

  it("does not save when favorite name is blank", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    renderWithTooltip(
      <FavoriteNameDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} defaultName="Saved query" />
    );

    const input = screen.getByLabelText("Favorite name");
    await user.clear(input);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
