import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobHistoryPage } from "./JobHistoryPage";
import { useSessionStore } from "@/stores/sessionStore";
import type { JobRunSummary } from "@/types/domain";

const mutate = vi.fn();
const startMutate = vi.fn();
const describeJob = vi.fn();
const describeJobRun = vi.fn();
const useJobRuns = vi.fn();
const useVirtualClusters = vi.fn();
const saveTextFile = vi.fn();
const toastError = vi.fn();
let describedJob: JobRunSummary | undefined;

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args)
  }
}));

vi.mock("@/services/fileDownload", () => ({
  saveTextFile: (...args: unknown[]) => saveTextFile(...args)
}));

vi.mock("@/services/emrService", () => ({
  emrService: {
    describeJobRun: (...args: unknown[]) => describeJobRun(...args)
  }
}));

vi.mock("@/hooks/useEmr", () => ({
  useJobRuns: (...args: unknown[]) => useJobRuns(...args),
  useVirtualClusters: (...args: unknown[]) => useVirtualClusters(...args),
  useDescribeJobRun: (id?: string, virtualClusterId?: string) => {
    describeJob(id, virtualClusterId);
    return {
      data: describedJob,
      isLoading: false,
      error: null
    };
  },
  useCancelJobRun: () => ({
    mutate,
    isPending: false
  }),
  useStartJobRun: () => ({
    mutate: startMutate,
    isPending: false
  })
}));

let jobs: JobRunSummary[];

function renderJobHistoryPage(props?: { onOpenLogs?: () => void; onOpenS3?: () => void }) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <JobHistoryPage {...props} />
    </QueryClientProvider>
  );
}

describe("JobHistoryPage", () => {
  beforeEach(() => {
    mutate.mockClear();
    startMutate.mockClear();
    describeJob.mockClear();
    describeJobRun.mockClear();
    saveTextFile.mockClear();
    toastError.mockClear();
    describedJob = undefined;
    jobs = makeJobs();
    describeJobRun.mockResolvedValue(jobs[0]);
    saveTextFile.mockResolvedValue("job-running-description.json");
    useJobRuns.mockClear();
    useJobRuns.mockReturnValue({
      data: jobs,
      isLoading: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn()
    });
    useVirtualClusters.mockReturnValue({
      data: {
        clusters: [{ id: "vc-1", name: "analytics", state: "RUNNING", namespace: "emr", eksClusterName: "eks", createdAt: "2026-06-10T00:00:00Z" }]
      },
      isLoading: false,
      error: null
    });
    useSessionStore.setState({
      selectedVirtualClusterId: "vc-1",
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedS3Bucket: undefined,
      selectedS3Prefix: undefined
    });
  });

  it("shows production actions, hides virtual cluster column, filters, and paginates", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();

    expect(screen.queryByRole("columnheader", { name: /Virtual Cluster/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Cancel$/i })).not.toBeInTheDocument();

    const runningRow = screen.getByRole("row", { name: /running-etl RUNNING/i });
    expect(within(runningRow).getByRole("button", { name: /Kill/i })).toBeInTheDocument();
    expect(within(runningRow).getByRole("button", { name: /Logs/i })).toBeInTheDocument();

    const failedRow = screen.getByRole("row", { name: /failed-etl FAILED/i });
    expect(within(failedRow).getByRole("button", { name: /Rerun/i })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "failed");
    expect(screen.queryByText("running-etl")).not.toBeInTheDocument();
    expect(screen.getByText("failed-etl")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/search jobs/i));
    expect(screen.getByText(/Page 1/i)).toBeInTheDocument();
    expect(screen.queryByText("paged-job-12")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("paged-job-12")).toBeInTheDocument();
  });

  it("shows job detail in a popover and copies the job id", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    renderJobHistoryPage();

    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Detail/i }));
    expect(screen.getByRole("dialog", { name: /Job Detail/i })).toBeInTheDocument();
    expect(describeJob).toHaveBeenCalledWith("job-running", "vc-1");

    await user.click(screen.getByRole("button", { name: /Copy Job ID/i }));
    expect(writeText).toHaveBeenCalledWith("job-running");
    expect(screen.queryByRole("dialog", { name: /Job Detail/i })).not.toBeInTheDocument();
  });

  it("downloads the described job detail as JSON", async () => {
    const user = userEvent.setup();
    describedJob = {
      ...jobs[0],
      describeDetails: {
        arn: "arn:aws:emr-containers:us-east-1:123456789012:/virtualclusters/vc-1/jobruns/job-running",
        releaseLabel: "emr-7.2.0-latest"
      }
    };

    renderJobHistoryPage();

    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Detail/i }));
    await user.click(screen.getByRole("button", { name: /Download JSON/i }));

    expect(saveTextFile).toHaveBeenCalledWith(
      "job-running-description.json",
      expect.stringContaining('"releaseLabel": "emr-7.2.0-latest"')
    );
  });

  it("shows describe_job_run details in the detail popover", async () => {
    const user = userEvent.setup();
    describedJob = {
      ...jobs[0],
      describeDetails: {
        arn: "arn:aws:emr-containers:us-east-1:123456789012:/virtualclusters/vc-1/jobruns/job-running",
        releaseLabel: "emr-7.2.0-latest",
        executionRoleArn: "arn:aws:iam::123456789012:role/EMR",
        stateDetails: "Job is running",
        jobDriver: {
          type: "sparkSubmit",
          entryPoint: "s3://bucket/app.jar",
          entryPointArguments: ["--date", "2026-06-10"],
          sparkSubmitParameters: "--class Main"
        },
        tags: { owner: "analytics" }
      }
    };

    renderJobHistoryPage();

    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Detail/i }));

    const dialog = screen.getByRole("dialog", { name: /Job Detail/i });
    expect(within(dialog).getByRole("button", { name: /Copy Job ID/i })).toBeInTheDocument();
    expect(within(dialog).getByText("emr-7.2.0-latest")).toBeInTheDocument();
    expect(within(dialog).getByText("arn:aws:iam::123456789012:role/EMR")).toBeInTheDocument();
    expect(within(dialog).getByText("Job is running")).toBeInTheDocument();
    expect(within(dialog).getByText(/s3:\/\/bucket\/app.jar/)).toBeInTheDocument();
    expect(within(dialog).getByText(/"owner": "analytics"/)).toBeInTheDocument();
  });

  it("derives duration from timestamps and closes detail on outside click", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();

    expect(screen.getByRole("row", { name: /completed-duration COMPLETED/i })).toHaveTextContent("1m 30s");

    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Detail/i }));
    expect(screen.getByRole("dialog", { name: /Job Detail/i })).toBeInTheDocument();

    await user.click(screen.getByPlaceholderText(/search jobs/i));
    expect(screen.queryByRole("dialog", { name: /Job Detail/i })).not.toBeInTheDocument();
  });

  it("enables 5 second auto refresh by default and allows turning it off", async () => {
    const user = userEvent.setup();
    localStorage.removeItem("emr-eks:job-history-auto-refresh");

    renderJobHistoryPage();

    expect(useJobRuns).toHaveBeenLastCalledWith("vc-1", true);
    expect(screen.getByText("5s")).toBeInTheDocument();
    expect(screen.queryByText("Auto refresh (5s)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /Auto refresh job history/i }));

    expect(useJobRuns).toHaveBeenLastCalledWith("vc-1", false);
    expect(window.localStorage.getItem("emr-eks:job-history-auto-refresh")).toBe("false");
  });

  it("opens logs with only the job context and lets Logs resolve destinations", async () => {
    const user = userEvent.setup();
    const onOpenLogs = vi.fn();

    renderJobHistoryPage({ onOpenLogs });

    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Logs/i }));

    expect(describeJobRun).not.toHaveBeenCalled();
    expect(useSessionStore.getState().selectedJobId).toBe("job-running");
    expect(useSessionStore.getState().selectedJobVirtualClusterId).toBe("vc-1");
    expect(onOpenLogs).toHaveBeenCalled();
    expect(useSessionStore.getState().selectedS3Bucket).toBeUndefined();
  });

  it("looks up a missing local job id from AWS using the selected virtual cluster", async () => {
    const user = userEvent.setup();
    describeJobRun.mockResolvedValue({
      id: "job-remote-only",
      name: "remote-only-etl",
      state: "RUNNING",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:20:00Z"
    });

    renderJobHistoryPage();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "job-remote-only");
    expect(screen.getByText("No jobs match the current filters.")).toBeInTheDocument();
    const emptyResultRow = screen.getByRole("row", { name: /No jobs match the current filters/i });
    expect(within(emptyResultRow).getByRole("button", { name: /Find in AWS/i })).toBeInTheDocument();

    await user.click(within(emptyResultRow).getByRole("button", { name: /Find in AWS/i }));

    expect(describeJobRun).toHaveBeenCalledWith("job-remote-only", "vc-1");
    expect(screen.getByRole("row", { name: /remote-only-etl RUNNING/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Job Detail/i })).toBeInTheDocument();
  });

  it("keeps search local-first and does not look up AWS while local rows match", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "running-etl{Enter}");

    expect(screen.getByRole("row", { name: /running-etl RUNNING/i })).toBeInTheDocument();
    expect(screen.queryByText("No jobs match the current filters.")).not.toBeInTheDocument();
    expect(describeJobRun).not.toHaveBeenCalled();
  });

  it("asks for a job id instead of calling AWS when secondary lookup input looks like a job name", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "jinghui");
    const emptyResultRow = screen.getByRole("row", { name: /No jobs match the current filters/i });
    await user.click(within(emptyResultRow).getByRole("button", { name: /Find in AWS/i }));

    expect(describeJobRun).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("For Find in AWS，use the Job ID rather then Job Name");
    expect(screen.getByText("For Find in AWS，use the Job ID rather then Job Name")).toBeInTheDocument();
  });

  it("shows a friendly message when AWS cannot find the searched job id", async () => {
    const user = userEvent.setup();
    describeJobRun.mockRejectedValue({
      kind: "aws",
      code: "AwsSdkError",
      message: "service error",
      service: "emr-containers"
    });

    renderJobHistoryPage();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "job-missing");
    const emptyResultRow = screen.getByRole("row", { name: /No jobs match the current filters/i });
    await user.click(within(emptyResultRow).getByRole("button", { name: /Find in AWS/i }));

    expect(toastError).toHaveBeenCalledWith(
      "Job job-missing was not found in AWS EMR for virtual cluster vc-1. Check the Job ID and selected Virtual Cluster."
    );
    expect(screen.getByText(/Job job-missing was not found in AWS EMR/i)).toBeInTheDocument();
  });
});

function makeJobs(): JobRunSummary[] {
  const base: JobRunSummary[] = [
    {
      id: "job-running",
      name: "running-etl",
      state: "RUNNING",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:00:00Z"
    },
    {
      id: "job-completed-duration",
      name: "completed-duration",
      state: "COMPLETED",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:00:00Z",
      startedAt: "2026-06-10T00:00:30Z",
      finishedAt: "2026-06-10T00:02:00Z"
    },
    {
      id: "job-failed",
      name: "failed-etl",
      state: "FAILED",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:01:00Z",
      sourceRequest: {
        name: "failed-etl",
        virtualClusterId: "vc-1",
        executionRoleArn: "arn:aws:iam::123456789012:role/EMR",
        releaseLabel: "emr-7.2.0-latest",
        application: { type: "jar", jarPath: "s3://bucket/app.jar", mainClass: "Main" },
        arguments: [],
        resources: {
          driverCores: 1,
          driverMemory: "2G",
          executorCores: 2,
          executorMemory: "4G",
          executorInstances: 2
        },
        sparkConfig: {},
        jobDriver: {
          sparkSubmitJobDriver: {
            entryPoint: "s3://bucket/app.jar",
            entryPointArguments: [],
            sparkSubmitParameters: "--class Main"
          }
        }
      }
    }
  ];

  return [
    ...base,
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `job-paged-${index + 1}`,
      name: `paged-job-${index + 1}`,
      state: "COMPLETED" as const,
      virtualClusterId: "vc-1",
      createdAt: `2026-06-10T00:${String(index + 2).padStart(2, "0")}:00Z`
    }))
  ];
}
