import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const setActiveAccountMutate = vi.fn();

vi.mock("@/hooks/useAwsSettings", () => ({
  useAwsAccounts: () => ({
    data: [
      {
        id: "acct-test",
        name: "Test",
        region: "us-east-1",
        accessKeyIdMasked: "AKIA****",
        isActive: true
      },
      {
        id: "acct-prod",
        name: "Production",
        region: "us-west-2",
        accessKeyIdMasked: "AKIB****",
        isActive: false
      }
    ],
    isLoading: false
  }),
  useActiveAwsAccount: () => ({
    data: { id: "acct-test", name: "Test", region: "us-east-1", accessKeyIdMasked: "AKIA****", isActive: true }
  }),
  useSetActiveAwsAccount: () => ({ mutate: setActiveAccountMutate, isPending: false })
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
          createdAt: "2026-06-10T00:00:00Z",
          updatedAt: "2026-06-10T00:00:00Z"
        }
      ]
    }
  }),
  useCreateTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDuplicateTemplate: () => ({ mutate: vi.fn(), isPending: false })
}));

vi.mock("@/hooks/useJobConfigTemplates", () => ({
  useJobConfigTemplates: () => ({
    data: [
      {
        id: "daily-etl",
        name: "Daily ETL Jar",
        payloadTemplate: "{}",
        customVariables: [],
        defaultResourceTemplateId: "tiny",
        builtIn: true,
        createdAt: "2026-06-10T00:00:00Z",
        updatedAt: "2026-06-10T00:00:00Z"
      }
    ]
  }),
  useSubmitUser: () => ({ data: "tester" }),
  useCreateJobConfigTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateJobConfigTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteJobConfigTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDuplicateJobConfigTemplate: () => ({ mutate: vi.fn(), isPending: false })
}));

vi.mock("@/hooks/useEmr", () => ({
  useVirtualClusters: () => ({ data: { clusters: [] } }),
  useJobRuns: () => ({
    data: [
      {
        id: "job-running",
        name: "running-etl",
        state: "RUNNING",
        virtualClusterId: "vc-1",
        createdAt: "2026-06-10T00:00:00Z"
      }
    ],
    isLoading: false,
    error: null
  }),
  useDescribeJobRun: () => ({ data: undefined, isLoading: false, error: null }),
  useCancelJobRun: () => ({ mutate: vi.fn(), isPending: false }),
  useStartJobRun: () => ({ mutate: vi.fn(), isPending: false })
}));

vi.mock("@/services/emrService", () => ({
  emrService: {
    describeJobRun: vi.fn(async () => ({
      id: "job-running",
      name: "running-etl",
      state: "RUNNING",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:00:00Z"
    }))
  }
}));

vi.mock("@/hooks/useLogs", () => ({
  useJobLogStreams: () => ({
    data: { jobId: "job-running", streams: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn()
  }),
  useJobLogs: () => ({
    data: { jobId: "job-running", entries: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn()
  }),
  useS3JobLogObjects: () => ({
    data: { bucket: "logs-bucket", objects: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn()
  }),
  useS3JobLogObject: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn()
  })
}));

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveAccountMutate.mockImplementation((_accountId: string, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
  });

  it("prioritizes Submit Job and switches pages from the sidebar", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: "Submit Job" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByText("Template-driven submission")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Job History/i }));

    expect(await screen.findByRole("heading", { name: "Submitted Jobs" })).toBeInTheDocument();
  });

  it("collapses the sidebar to icon-only navigation", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("button", { name: /Collapse navigation/i }));

    const navigation = screen.getByRole("navigation", { name: "Primary" });
    expect(within(navigation).queryByText("Template-driven submission")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand navigation/i })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: "Submit Job" })).toBeInTheDocument();
  });

  it("opens Templates as a standalone page with Application Config as the default tab", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    );

    expect(screen.getByRole("button", { name: "Templates" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Templates" }));

    expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Application Config" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("heading", { name: "Application Config" })).toBeInTheDocument();
  });

  it("switches Resource Templates inside the Templates page", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("button", { name: "Templates" }));
    await user.click(screen.getByRole("tab", { name: "Resource Templates" }));

    expect(screen.getByRole("tab", { name: "Resource Templates" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("heading", { name: "Resource Templates" })).toBeInTheDocument();
  });

  it("opens the account dialog from the account summary and switches accounts", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("button", { name: /Switch AWS account/i }));
    const dialog = screen.getByRole("dialog", { name: /Switch AWS Account/i });
    expect(within(dialog).getByText("Production")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Use/i }));

    expect(setActiveAccountMutate).toHaveBeenCalledWith("acct-prod", expect.any(Object));
    expect(screen.queryByRole("dialog", { name: /Switch AWS Account/i })).not.toBeInTheDocument();
  });

  it("opens Logs from a Job History row", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("button", { name: /Job History/i }));
    await screen.findByRole("heading", { name: "Submitted Jobs" });
    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Logs/i }));

    expect(await screen.findByRole("heading", { name: "Job Logs" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Manual CloudWatch log group/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Job-level stream prefix/i)).not.toBeInTheDocument();
  });
});
