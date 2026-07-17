import { render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
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
    expect(editor).toHaveClass("max-w-full", "overflow-hidden", "min-w-0");
    expect(editor.querySelector(".cm-content")).toHaveTextContent('{"name":"${template_name}"}');
  });

  it("calls onChange when its document is edited", () => {
    const onChange = vi.fn();
    render(<JsonTemplateEditor value='{"name":"initial"}' onChange={onChange} knownVariables={[]} />);

    const content = screen.getByRole("textbox", { name: /payload json/i }).querySelector(".cm-content") as HTMLElement;
    const view = EditorView.findFromDOM(content);
    if (!view) throw new Error("Expected CodeMirror editor view");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"name":"updated"}' } });

    expect(onChange).toHaveBeenCalledWith('{"name":"updated"}');
  });
});
