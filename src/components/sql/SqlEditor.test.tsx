import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MySQL, PostgreSQL } from "@codemirror/lang-sql";
import { lintGutter } from "@codemirror/lint";
import { SqlEditor } from "./SqlEditor";

describe("SqlEditor", () => {
  it("renders the document under an accessible name", () => {
    render(<SqlEditor value="SELECT 1;" onChange={vi.fn()} dialect={MySQL} />);

    // A contenteditable has no accessible name of its own, so this also pins
    // the contentAttributes contract the workspace tests rely on.
    expect(screen.getByLabelText("SQL editor")).toHaveTextContent("SELECT 1;");
  });

  it("compiles no linter or completion unless the dialect supplies one", () => {
    const { container } = render(
      <SqlEditor value="SELECT 1;" onChange={vi.fn()} dialect={PostgreSQL} />
    );

    // An empty compartment must not leave the lint gutter behind — an empty
    // gutter column is what a bare `lintGutter()` would draw for JDBC.
    expect(container.querySelector(".cm-gutter-lint")).toBeNull();
  });

  it("takes a dialect's own diagnostics when it has them", () => {
    // The other half of the contract: Athena's linter arrives through this
    // seam, so an empty compartment must be the only reason the gutter is
    // absent above.
    const { container } = render(
      <SqlEditor
        value="SELECT 1;"
        onChange={vi.fn()}
        dialect={PostgreSQL}
        diagnostics={lintGutter()}
      />
    );

    expect(container.querySelector(".cm-gutter-lint")).not.toBeNull();
  });
});
