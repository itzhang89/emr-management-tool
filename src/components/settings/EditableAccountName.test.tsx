import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditableAccountName } from "./EditableAccountName";

describe("EditableAccountName", () => {
  it("renames on double-click then Enter", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);

    render(<EditableAccountName name="prod" onRename={onRename} />);

    await user.dblClick(screen.getByRole("button", { name: "prod" }));
    const input = screen.getByRole("textbox", { name: /Rename account/i });
    await user.clear(input);
    await user.type(input, "staging{Enter}");

    expect(onRename).toHaveBeenCalledWith("staging");
  });

  it("cancels on Escape without calling onRename", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();

    render(<EditableAccountName name="prod" onRename={onRename} />);

    await user.dblClick(screen.getByRole("button", { name: "prod" }));
    await user.type(screen.getByRole("textbox", { name: /Rename account/i }), "staging{Escape}");

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "prod" })).toBeInTheDocument();
  });
});
