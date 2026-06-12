import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogsPage } from "./LogsPage";
import { useSessionStore } from "@/stores/sessionStore";

const useDescribeJobRun = vi.fn();
const useJobLogStreams = vi.fn();
const useJobLogs = vi.fn();
const useS3JobLogObjects = vi.fn();
const useS3JobLogObject = vi.fn();

vi.mock("@/hooks/useEmr", () => ({
  useDescribeJobRun: (...args: unknown[]) => useDescribeJobRun(...args)
}));

vi.mock("@/hooks/useLogs", () => ({
  useJobLogStreams: (...args: unknown[]) => useJobLogStreams(...args),
  useJobLogs: (...args: unknown[]) => useJobLogs(...args),
  useS3JobLogObjects: (...args: unknown[]) => useS3JobLogObjects(...args),
  useS3JobLogObject: (...args: unknown[]) => useS3JobLogObject(...args)
}));

describe("LogsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    useSessionStore.setState({
      selectedJobId: "job-running",
      selectedJobVirtualClusterId: "vc-1",
      selectedVirtualClusterId: undefined,
      selectedS3Bucket: undefined,
      selectedS3Prefix: undefined
    });
    useDescribeJobRun.mockReturnValue({
      data: {
        id: "job-running",
        name: "running-etl",
        state: "RUNNING",
        virtualClusterId: "vc-1",
        createdAt: "2026-06-10T00:00:00Z",
        describeDetails: {
          configurationOverrides: {
            monitoringConfiguration: {
              cloudWatchMonitoringConfiguration: {
                logGroupName: "/emr-containers/jobs",
                logStreamNamePrefix: "20260612"
              },
              s3MonitoringConfiguration: {
                logUri: "s3://logs-bucket/logs/"
              }
            }
          }
        }
      },
      isLoading: false,
      error: null
    });
    useJobLogStreams.mockReturnValue({
      data: {
        jobId: "job-running",
        streams: [
          {
            source: "cloudwatch",
            id: "cw-driver-stdout",
            label: "driver stdout",
            type: "driver",
            container: "spark-app",
            pod: "driver",
            stream: "stdout",
            cloudWatchStreamName: "20260612/vc-1/jobs/job-running/containers/spark-app/driver/stdout"
          }
        ]
      },
      isLoading: false,
      error: null
    });
    useJobLogs.mockReturnValue({
      data: {
        jobId: "job-running",
        entries: [{ timestamp: "2026-06-10T00:00:00Z", level: "info", message: "hello cloudwatch", streamName: "cw" }]
      },
      isLoading: false,
      error: null
    });
    useS3JobLogObjects.mockReturnValue({
      data: {
        bucket: "logs-bucket",
        objects: [
          {
            source: "s3",
            id: "s3-driver-stdout",
            label: "driver stdout",
            type: "driver",
            container: "spark-app",
            pod: "driver",
            stream: "stdout",
            s3Key: "logs/vc-1/jobs/job-running/containers/spark-app/driver/stdout.gz",
            size: 123
          }
        ]
      },
      isLoading: false,
      error: null
    });
    useS3JobLogObject.mockReturnValue({
      data: { bucket: "logs-bucket", key: "stdout.gz", content: "hello s3\n" },
      isLoading: false,
      error: null
    });
  });

  it("resolves destinations from describe, defaults to CloudWatch, and keeps S3 as a tab", async () => {
    const user = userEvent.setup();

    renderLogsPage();

    expect(useDescribeJobRun).toHaveBeenCalledWith("job-running", "vc-1");
    expect(useJobLogStreams).toHaveBeenCalledWith(
      {
        jobId: "job-running",
        logGroupName: "/emr-containers/jobs",
        streamNamePrefix: "20260612/vc-1/jobs/job-running/"
      },
      false
    );
    expect(screen.getByText("/emr-containers/jobs")).toBeInTheDocument();
    expect(screen.getByText("20260612/vc-1/jobs/job-running/")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /CloudWatch Live/i })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /S3 Archive/i }));
    expect(screen.getByText("s3://logs-bucket/logs/vc-1/jobs/job-running/")).toBeInTheDocument();
  });

  it("removes low-value controls and manual CloudWatch inputs", () => {
    renderLogsPage();

    expect(screen.queryByPlaceholderText(/Search log text/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Manual CloudWatch log group/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Job-level stream prefix/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download Current Log/i })).toBeInTheDocument();
  });

  it("defaults to S3 when the job only has S3 monitoring configured", () => {
    useDescribeJobRun.mockReturnValue({
      data: {
        id: "job-running",
        name: "running-etl",
        state: "RUNNING",
        virtualClusterId: "vc-1",
        createdAt: "2026-06-10T00:00:00Z",
        describeDetails: {
          configurationOverrides: {
            monitoringConfiguration: {
              s3MonitoringConfiguration: {
                logUri: "s3://logs-bucket/logs/"
              }
            }
          }
        }
      },
      isLoading: false,
      error: null
    });

    renderLogsPage();

    expect(screen.getByRole("tab", { name: /S3 Archive/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /CloudWatch Live/i })).toBeDisabled();
    expect(useS3JobLogObjects).toHaveBeenCalledWith({
      bucket: "logs-bucket",
      prefix: "logs/vc-1/jobs/job-running/"
    });
  });

  it("uses the default CloudWatch destination when monitoring config is absent", () => {
    useDescribeJobRun.mockReturnValue({
      data: {
        id: "job-running",
        name: "running-etl",
        state: "RUNNING",
        virtualClusterId: "vc-1",
        createdAt: "2026-06-10T00:00:00Z"
      },
      isLoading: false,
      error: null
    });

    renderLogsPage();

    expect(screen.getByRole("tab", { name: /CloudWatch Live/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("/aws/emr-containers/jobs/job-running")).toBeInTheDocument();
    expect(screen.getByText("job-running")).toBeInTheDocument();
  });

  it("downloads the currently selected log text with a stable filename", async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.fn<(blob: Blob) => string>(() => "blob:log");
    const revokeObjectUrl = vi.fn();
    const anchor = document.createElement("a");
    const click = vi.spyOn(anchor, "click").mockImplementation(() => {});
    const appendChild = vi.spyOn(document.body, "appendChild");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });

    renderLogsPage();

    await user.click(screen.getByRole("button", { name: /stdout/i }));
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    await user.click(screen.getByRole("button", { name: /Download Current Log/i }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    await expect((createObjectUrl.mock.calls[0][0] as Blob).text()).resolves.toBe(
      "2026-06-10T00:00:00Z INFO hello cloudwatch"
    );
    expect(anchor.download).toBe("job-running-driver-stdout.log");
    expect(appendChild).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:log");
  });
});

function renderLogsPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LogsPage />
    </QueryClientProvider>
  );
}
