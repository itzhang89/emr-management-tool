import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubmitJobPage } from "@/pages/SubmitJobPage";

vi.mock("@/hooks/useEmr", () => ({
  useVirtualClusters: () => ({
    data: {
      clusters: [{ id: "vc-1", name: "analytics", namespace: "emr", state: "RUNNING", eksClusterName: "eks", createdAt: "" }]
    }
  }),
  useStartJobRun: () => ({ mutateAsync: vi.fn(), isPending: false })
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
        customVariables: [],
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
  it("renders template-driven submit controls without legacy save template action", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SubmitJobPage />
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: "Submit Job" })).toBeInTheDocument();
    expect(screen.getByText("Job Config Template")).toBeInTheDocument();
    expect(screen.getByText("Runtime Selection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview JSON/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save Template/i })).not.toBeInTheDocument();
  });
});
