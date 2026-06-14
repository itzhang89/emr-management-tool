import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationConfigTemplatesPage } from "@/pages/ApplicationConfigTemplatesPage";

const { deleteTemplate, openTextFile, toastError } = vi.hoisted(() => ({
  deleteTemplate: vi.fn(),
  openTextFile: vi.fn(),
  toastError: vi.fn()
}));

vi.mock("@/hooks/useJobConfigTemplates", () => ({
  useJobConfigTemplates: () => ({
    data: [
      {
        id: "daily-etl",
        name: "example",
        description: "Starter template",
        payloadTemplate: "{}",
        customVariables: [{ name: "ENV", type: "enum", options: ["dev", "prod"] }],
        defaultResourceTemplateId: "tiny",
        builtIn: true,
        createdAt: "",
        updatedAt: ""
      }
    ]
  }),
  useCreateJobConfigTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateJobConfigTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

describe("ApplicationConfigTemplatesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists application config templates", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ApplicationConfigTemplatesPage />
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: "Application Config" })).toBeInTheDocument();
    expect(screen.getByText("example")).toBeInTheDocument();
    expect(screen.getByText(/1 variable/i)).toBeInTheDocument();
  });

  it("numbers custom variables and lets users reorder them", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ApplicationConfigTemplatesPage />
      </QueryClientProvider>
    );

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
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ApplicationConfigTemplatesPage />
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("button", { name: /Template/i }));
    await user.click(screen.getByRole("button", { name: /Import JSON/i }));
    const nameInput = screen.getByDisplayValue("Imported Template");
    await user.clear(nameInput);
    await user.type(nameInput, "Changed Template");
    await user.click(screen.getByRole("button", { name: /Reset/i }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("overwrite all current settings"));
    expect(screen.getByDisplayValue("Imported Template")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Business date")).toBeInTheDocument();
  });

  it("shows a helpful message instead of deleting built-in example templates", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ApplicationConfigTemplatesPage />
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("button", { name: /Delete example/i }));

    expect(deleteTemplate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Built-in example templates are for reference and cannot be deleted.");
  });
});
