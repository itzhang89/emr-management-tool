import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TemplateVariableFields } from "@/components/templates/TemplateVariableFields";

describe("TemplateVariableFields", () => {
  it("disables browser autocapitalization for text variable inputs", () => {
    render(
      <TooltipProvider>
        <TemplateVariableFields
          variables={[{ name: "submitUser", type: "text" }]}
          values={{ submitUser: "jinghui" }}
          onChange={vi.fn()}
        />
      </TooltipProvider>
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("renders boolean variables as a checkbox", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <TooltipProvider>
        <TemplateVariableFields
          variables={[{ name: "enabled", label: "Adaptive enabled", type: "boolean" }]}
          values={{ enabled: false }}
          onChange={onChange}
        />
      </TooltipProvider>
    );

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText("Adaptive enabled")).toBeInTheDocument();

    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
  });
});
