import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SubmitJobPage } from "@/pages/SubmitJobPage";

const mocks = vi.hoisted(() => ({
  startJobRun: vi.fn(),
  toastError: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn()
  }
}));

vi.mock("@/hooks/useEmr", () => ({
  useVirtualClusters: () => ({
    data: {
      clusters: [{ id: "vc-1", name: "analytics", namespace: "emr", state: "RUNNING", eksClusterName: "eks", createdAt: "" }]
    }
  }),
  useStartJobRun: () => ({ mutateAsync: mocks.startJobRun, isPending: false })
}));

vi.mock("@/hooks/useTemplates", () => ({
  useTemplates: () => ({
    data: {
      resourceTemplates: [
        {
          id: "tiny",
          name: "Tiny",
          resources: {
            driverCores: 1,
            driverMemory: "1G",
            executorCores: 1,
            executorMemory: "1G",
            executorInstances: 1
          },
          builtIn: true,
          createdAt: "",
          updatedAt: ""
        }
      ]
    }
  })
}));

vi.mock("@/hooks/useJobConfigTemplates", () => ({
  useJobConfigTemplates: () => ({
    data: [
      {
        id: "daily-etl",
        name: "Daily ETL Jar",
        payloadTemplate: `{
          "name": "daily-\${submitUser}",
          "virtualClusterId": "\${virtualClusterId}",
          "executionRoleArn": "arn:aws:iam::123456789012:role/EMR",
          "releaseLabel": "emr-7.2.0-latest",
          "jobDriver": {
            "sparkSubmitJobDriver": {
              "entryPoint": "s3://bucket/app.jar",
              "entryPointArguments": [],
              "sparkSubmitParameters": "--class com.example.Main"
            }
          }
        }`,
        customVariables: [{ name: "ENV", type: "text", description: "Runtime environment name" }],
        defaultResourceTemplateId: "tiny",
        createdAt: "",
        updatedAt: ""
      }
    ]
  }),
  useSubmitUser: () => ({ data: "tester" })
}));

vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setSelectedVirtualClusterId: vi.fn(),
      clonedJobRequest: undefined,
      setClonedJobRequest: vi.fn()
    })
}));

describe("SubmitJobPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders template-driven submit controls without legacy save template action", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SubmitJobPage />
        </TooltipProvider>
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: "Submit Job" })).toBeInTheDocument();
    expect(screen.getByText("Job Config Template")).toBeInTheDocument();
    expect(screen.getByText("Runtime Selection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview JSON/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save Template/i })).not.toBeInTheDocument();
  });

  it("shows custom variable descriptions as label tooltips", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SubmitJobPage />
        </TooltipProvider>
      </QueryClientProvider>
    );

    await user.hover(screen.getByText("ENV"));

    expect((await screen.findAllByText("Runtime environment name")).length).toBeGreaterThan(0);
  });

  it("shows structured Tauri submit errors instead of a generic fallback", async () => {
    const user = userEvent.setup();
    mocks.startJobRun.mockRejectedValue({
      message: "Job name can only contain letters, numbers, dot, hyphen, underscore, slash, or #."
    });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SubmitJobPage />
        </TooltipProvider>
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("button", { name: /^Submit$/i }));

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Job name can only contain letters, numbers, dot, hyphen, underscore, slash, or #."
    );
  });
});
