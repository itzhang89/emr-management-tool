import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobHistoryPage } from "./JobHistoryPage";
import type { JobRunSummary } from "@/types/domain";

const mutate = vi.fn();
const startMutate = vi.fn();

vi.mock("@/hooks/useEmr", () => ({
  useJobRuns: () => ({
    data: jobs,
    isLoading: false,
    error: null
  }),
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

describe("JobHistoryPage", () => {
  beforeEach(() => {
    mutate.mockClear();
    startMutate.mockClear();
    jobs = makeJobs();
  });

  it("shows production actions, hides virtual cluster column, filters, and paginates", async () => {
    const user = userEvent.setup();

    render(<JobHistoryPage />);

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

    render(<JobHistoryPage />);

    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Detail/i }));
    expect(screen.getByRole("dialog", { name: /Job Detail/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Copy Job ID/i }));
    expect(writeText).toHaveBeenCalledWith("job-running");
    expect(screen.queryByRole("dialog", { name: /Job Detail/i })).not.toBeInTheDocument();
  });

  it("derives duration from timestamps and closes detail on outside click", async () => {
    const user = userEvent.setup();

    render(<JobHistoryPage />);

    expect(screen.getByRole("row", { name: /completed-duration COMPLETED/i })).toHaveTextContent("1m 30s");

    await user.click(within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Detail/i }));
    expect(screen.getByRole("dialog", { name: /Job Detail/i })).toBeInTheDocument();

    await user.click(screen.getByPlaceholderText(/search jobs/i));
    expect(screen.queryByRole("dialog", { name: /Job Detail/i })).not.toBeInTheDocument();
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
