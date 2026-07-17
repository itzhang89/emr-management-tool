import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JsonTemplateEditor } from "./JsonTemplateEditor";

describe("JsonTemplateEditor", () => {
  it("renders an accessible editor with its initial document", () => {
    const onChange = vi.fn();
    render(
      <JsonTemplateEditor
        value='{"name":"${template_name}"}'
        onChange={onChange}
        knownVariables={["template_name"]}
      />
    );

    const editor = screen.getByRole("textbox", { name: /payload json/i });
    expect(editor).toBeInTheDocument();
    expect(editor.querySelector(".cm-content")).toHaveTextContent('{"name":"${template_name}"}');
  });
});
