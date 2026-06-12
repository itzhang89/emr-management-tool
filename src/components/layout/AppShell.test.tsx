import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("@/hooks/useAwsSettings", () => ({
  useAwsAccounts: () => ({ data: [] })
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
  it("prioritizes Submit Job and switches pages from the sidebar", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { name: "Submit Job" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Job History/i }));

    expect(screen.getByRole("heading", { name: "Job History" })).toBeInTheDocument();
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
    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Logs/i }));

    expect(screen.getByRole("heading", { name: "Logs" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Manual CloudWatch log group/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Job-level stream prefix/i)).not.toBeInTheDocument();
  });
});
