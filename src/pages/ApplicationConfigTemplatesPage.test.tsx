import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationConfigTemplatesPage } from "@/pages/ApplicationConfigTemplatesPage";

vi.mock("@/hooks/useJobConfigTemplates", () => ({
  useJobConfigTemplates: () => ({
    data: [
      {
        id: "daily-etl",
        name: "Daily ETL Jar",
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
  useDeleteJobConfigTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDuplicateJobConfigTemplate: () => ({ mutate: vi.fn(), isPending: false })
}));

vi.mock("@/hooks/useTemplates", () => ({
  useTemplates: () => ({
    data: {
      resourceTemplates: [{ id: "tiny", name: "Tiny", resources: {}, builtIn: true, createdAt: "", updatedAt: "" }]
    }
  })
}));

describe("ApplicationConfigTemplatesPage", () => {
  it("lists application config templates", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ApplicationConfigTemplatesPage />
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: "Application Config" })).toBeInTheDocument();
    expect(screen.getByText("Daily ETL Jar")).toBeInTheDocument();
    expect(screen.getByText(/1 variable/i)).toBeInTheDocument();
  });
});
