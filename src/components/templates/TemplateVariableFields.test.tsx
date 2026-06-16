import { render, screen } from "@testing-library/react";
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
});
