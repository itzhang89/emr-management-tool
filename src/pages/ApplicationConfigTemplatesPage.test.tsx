import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApplicationConfigTemplatesPage } from "@/pages/ApplicationConfigTemplatesPage";
import type { JobConfigTemplate } from "@/types/domain";

const { createTemplate, importTemplate, updateTemplate, setTemplateScope, listTemplates, deleteTemplate, openTextFile, toastError } = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  importTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  setTemplateScope: vi.fn(),
  listTemplates: vi.fn<() => JobConfigTemplate[]>(),
  deleteTemplate: vi.fn(),
  openTextFile: vi.fn(),
  toastError: vi.fn()
}));

vi.mock("@/hooks/useJobConfigTemplates", () => ({
  useJobConfigTemplates: () => ({ data: listTemplates() }),
  useCreateJobConfigTemplate: () => ({ mutateAsync: createTemplate, isPending: false }),
  useImportJobConfigTemplate: () => ({ mutateAsync: importTemplate, isPending: false }),
  useUpdateJobConfigTemplate: () => ({ mutateAsync: updateTemplate, isPending: false }),
  useSetJobConfigTemplateScope: () => ({ mutateAsync: setTemplateScope, isPending: false }),
  useDeleteJobConfigTemplate: () => ({ mutateAsync: deleteTemplate, isPending: false }),
  useDuplicateJobConfigTemplate: () => ({ mutate: vi.fn(), isPending: false })
}));

vi.mock("@/services/fileDownload", () => ({
  openTextFile,
  saveTextFile: vi.fn()
}));

vi.mock("@/hooks/useTemplates", () => ({
  useTemplates: () => ({
    data: {
      resourceTemplates: [{ id: "tiny", name: "Tiny", resources: {}, builtIn: true, createdAt: "", updatedAt: "" }]
    }
  })
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: toastError
  }
}));

const example: JobConfigTemplate = {
  id: "daily-etl",
  name: "example",
  description: "Starter template",
  payloadTemplate: "{}",
  customVariables: [{ name: "ENV", type: "enum", options: ["dev", "prod"] }],
  defaultResourceTemplateId: "tiny",
  builtIn: true,
  createdAt: "",
  updatedAt: ""
};

describe("ApplicationConfigTemplatesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTemplates.mockReturnValue([example]);
  });

  function renderPage() {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ApplicationConfigTemplatesPage />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  it("lists application config templates", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Application Config" })).toBeInTheDocument();
    expect(screen.getByText("example")).toBeInTheDocument();
    expect(screen.getByText(/1 variable/i)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Share with all accounts" })).not.toBeInTheDocument();
  });

  it("passes the original name to the import mutation for conflict resolution", async () => {
    const user = userEvent.setup();
    openTextFile.mockResolvedValueOnce(JSON.stringify({ name: "example", payloadTemplate: "{}" }));
    renderPage();

    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(importTemplate).toHaveBeenCalledWith(expect.objectContaining({ name: "example" }));
    expect(createTemplate).not.toHaveBeenCalled();
  });

  it.each([
    { scope: "private", nextScope: "shared" },
    { scope: "shared", nextScope: "private" }
  ] as const)("can change a $scope template to $nextScope from its card", async ({ scope, nextScope }) => {
    const user = userEvent.setup();
    const customTemplate = { ...example, id: "custom", builtIn: false, name: "Daily ETL", scope };
    listTemplates.mockReturnValue([example, customTemplate]);
    setTemplateScope.mockImplementationOnce(async () => {
      listTemplates.mockReturnValue([example, { ...customTemplate, scope: nextScope }]);
    });
    renderPage();

    const share = screen.getByRole("switch", { name: "Share with all accounts" });
    expect(share).toHaveAttribute("aria-checked", String(scope === "shared"));
    await user.click(share);
    if (scope === "shared") {
      let confirmation = within(screen.getByRole("dialog", { name: "Stop sharing?" }));
      expect(confirmation.getByText("This template will belong to the current account.")).toBeInTheDocument();
      await user.click(confirmation.getByRole("button", { name: "Cancel" }));
      expect(setTemplateScope).not.toHaveBeenCalled();
      expect(share).toBeChecked();

      await user.click(share);
      confirmation = within(screen.getByRole("dialog", { name: "Stop sharing?" }));
      await user.click(confirmation.getByRole("button", { name: "Stop sharing" }));
      expect(share).not.toBeChecked();
      expect(screen.getByText("Current account")).toBeInTheDocument();
    }

    expect(setTemplateScope).toHaveBeenCalledWith({ id: "custom", scope: nextScope });
  });

  it("saves edits when stopping sharing from the editor after confirmation", async () => {
    const user = userEvent.setup();
    const sharedTemplate = { ...example, id: "custom", builtIn: false, name: "Daily ETL", scope: "shared" } as const;
    listTemplates.mockReturnValue([example, sharedTemplate]);
    updateTemplate.mockImplementationOnce(async (template: JobConfigTemplate) => {
      listTemplates.mockReturnValue([example, template]);
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Edit Daily ETL" }));
    const editor = within(screen.getByRole("dialog", { name: "Edit application config template" }));
    await user.click(editor.getByRole("switch", { name: "Share with all accounts" }));
    const description = editor.getByDisplayValue("Starter template");
    await user.clear(description);
    await user.type(description, "Updated details");
    await user.click(editor.getByRole("button", { name: "Save" }));

    let confirmation = within(screen.getByRole("dialog", { name: "Stop sharing?" }));
    await user.click(confirmation.getByRole("button", { name: "Cancel" }));
    expect(updateTemplate).not.toHaveBeenCalled();
    expect(editor.getByDisplayValue("Updated details")).toBeInTheDocument();

    await user.click(editor.getByRole("button", { name: "Save" }));
    confirmation = within(screen.getByRole("dialog", { name: "Stop sharing?" }));
    await user.click(confirmation.getByRole("button", { name: "Stop sharing" }));

    expect(updateTemplate).toHaveBeenCalledWith(expect.objectContaining({
      id: sharedTemplate.id,
      scope: "private",
      description: "Updated details"
    }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Share with all accounts" })).not.toBeChecked();
  });

  it("can create a job config template shared with all accounts", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Template" }));
    const share = screen.getByRole("switch", { name: "Share with all accounts" });
    expect(share).not.toBeChecked();
    await user.click(share);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(createTemplate).toHaveBeenCalledWith(expect.objectContaining({ scope: "shared" }));
  });

  it("disables browser autocapitalization for template editor text inputs", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Template/i }));
    await user.click(screen.getByRole("button", { name: /Add Variable/i }));

    const variableNameInput = screen.getByPlaceholderText("Variable name");
    expect(variableNameInput).toHaveAttribute("autocapitalize", "none");
    expect(variableNameInput).toHaveAttribute("autocorrect", "off");
    expect(variableNameInput).toHaveAttribute("spellcheck", "false");
  });

  it("uses the JSON template editor for the payload field", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Template/i }));

    expect(screen.getByRole("textbox", { name: "Payload JSON" })).toHaveClass("json-template-editor");
  });

  it("numbers custom variables and lets users reorder them", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Template/i }));
    await user.click(screen.getByRole("button", { name: /Add Variable/i }));
    await user.click(screen.getByRole("button", { name: /Add Variable/i }));

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Move VAR_2 up/i }));

    const variableNameInputs = screen.getAllByPlaceholderText("Variable name") as HTMLInputElement[];
    expect(variableNameInputs[0]?.value).toBe("VAR_2");
    expect(variableNameInputs[1]?.value).toBe("VAR_1");
  });

  it("resets the editor to the first imported JSON snapshot after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    openTextFile.mockResolvedValue(
      JSON.stringify({
        name: "Imported Template",
        description: "Imported description",
        payloadTemplate: "{\"name\":\"imported\"}",
        customVariables: [{ name: "DATE", type: "date", description: "Business date" }],
        defaultResourceTemplateId: "tiny"
      })
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Template/i }));
    await user.click(screen.getByRole("button", { name: /Import JSON/i }));
    const nameInput = screen.getByDisplayValue("Imported Template");
    await user.clear(nameInput);
    await user.type(nameInput, "Changed Template");
    await user.click(screen.getByRole("button", { name: /Reset/i }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("overwrite all current settings"));
    expect(screen.getByDisplayValue("Imported Template")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Edit DATE description/i }));
    expect(screen.getByDisplayValue("Business date")).toBeInTheDocument();
  });

  it("edits variable descriptions from the help icon and shows them on hover", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Template/i }));
    await user.click(screen.getByRole("button", { name: /Add Variable/i }));
    await user.click(screen.getByRole("button", { name: /Edit VAR_1 description/i }));
    await user.type(screen.getByPlaceholderText("Optional description shown on hover in Submit Job."), "Used in job arguments");
    await user.click(screen.getByRole("button", { name: /Confirm/i }));

    expect(screen.queryByPlaceholderText("Optional description shown on hover in Submit Job.")).not.toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: /Edit VAR_1 description/i }));

    expect((await screen.findAllByText("Used in job arguments")).length).toBeGreaterThan(0);
  });

  it("keeps variable row controls inside the dialog width once the payload editor is contained", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Template/i }));
    await user.click(screen.getByRole("button", { name: /Add Variable/i }));

    const payloadEditor = screen.getByRole("textbox", { name: /payload json/i });
    const nameInput = screen.getByPlaceholderText("Variable name");
    const nameRow = nameInput.closest("div.grid");

    expect(payloadEditor).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    expect(nameRow).toHaveClass("grid-cols-[2.75rem_minmax(0,1fr)_9.5rem_minmax(0,1fr)_auto]");
    expect(screen.getByRole("button", { name: /Remove VAR_1/i })).toHaveClass("size-8");
    expect(screen.getByText("Required").closest("label")?.parentElement).toHaveClass("shrink-0");

    await user.click(screen.getByRole("button", { name: /Remove VAR_1/i }));
    const confirmation = within(screen.getByRole("dialog", { name: "Delete variable “VAR_1”?" }));
    await user.click(confirmation.getByRole("button", { name: "Delete" }));
    expect(screen.queryByPlaceholderText("Variable name")).not.toBeInTheDocument();
  });

  it("shows boolean output format options for boolean variables", async () => {
    openTextFile.mockResolvedValue(
      JSON.stringify({
        name: "Bool Template",
        payloadTemplate: "{\"name\":\"bool\"}",
        customVariables: [{ name: "enabled", type: "boolean", defaultValue: false, format: "numeric" }]
      })
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Template/i }));
    await user.click(screen.getByRole("button", { name: /Import JSON/i }));

    expect(screen.getByText("1 / 0")).toBeInTheDocument();
    expect(
      screen.getByText('Default: unchecked → "0". Checked → "1"; unchecked → "0".')
    ).toBeInTheDocument();
    expect(screen.getByText("1 / 0").closest("button")).toHaveClass("w-[11rem]");
  });

  it("shows enum display format options for enum variables", async () => {
    openTextFile.mockResolvedValue(
      JSON.stringify({
        name: "Enum Template",
        payloadTemplate: "{\"name\":\"enum\"}",
        customVariables: [{ name: "ENV", type: "enum", options: ["dev", "prod"], format: "combobox" }]
      })
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Template/i }));
    await user.click(screen.getByRole("button", { name: /Import JSON/i }));

    expect(screen.getByText("combobox")).toBeInTheDocument();
  });

  it("shows a helpful message instead of deleting built-in example templates", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Delete example/i }));

    expect(deleteTemplate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Built-in example templates are for reference and cannot be deleted.");
  });
});
