import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders headings, lists, and emphasis instead of raw markdown", () => {
    render(<Markdown text={"# Summary\n\n- **first**\n- second"} />);

    expect(screen.getByText("Summary")).toBeInTheDocument();
    // Not the literal "# Summary" or "**second**".
    expect(screen.queryByText(/# Summary/)).not.toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.queryByText("**second**")).not.toBeInTheDocument();
  });

  it("renders a fenced code block with a copy button and language tag", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator.clipboard, { writeText });

    render(<Markdown text={"```json\n{\"a\": 1}\n```"} />);

    expect(screen.getByText("json")).toBeInTheDocument();
    expect(screen.getByText('{"a": 1}')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /copy json code/i }));
    expect(writeText).toHaveBeenCalledWith('{"a": 1}\n');
  });

  it("renders a table from GFM", () => {
    render(<Markdown text={"| A | B |\n| --- | --- |\n| 1 | 2 |\n"} />);

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("keeps inline code styled inline", () => {
    render(<Markdown text={"run `spark-submit` now"} />);

    expect(screen.getByText("spark-submit")).toBeInTheDocument();
    expect(screen.queryByText("`spark-submit`")).not.toBeInTheDocument();
  });
});
