import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogsPage } from "./LogsPage";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MAX_LOG_VIEW_CHARACTERS } from "@/services/logDisplay";
import { useSessionStore } from "@/stores/sessionStore";

const useDescribeJobRun = vi.fn();
const useJobLogStreams = vi.fn();
const useJobLogs = vi.fn();
const useS3JobLogObjects = vi.fn();
const useS3JobLogObject = vi.fn();
const getJobLogs = vi.fn();
const getJobLogObject = vi.fn();
const saveTextFile = vi.fn();

vi.mock("@/services/fileDownload", () => ({
  saveTextFile: (...args: unknown[]) => saveTextFile(...args)
}));

const useVirtualClusters = vi.fn();
const useEffectiveVirtualClusterId = vi.fn();

vi.mock("@/components/emr/VirtualClusterSelect", () => ({
  VirtualClusterSelect: () => <div data-testid="virtual-cluster-select">Virtual Cluster</div>,
  useEffectiveVirtualClusterId: () => useEffectiveVirtualClusterId()
}));

vi.mock("@/hooks/useEmr", () => ({
  useDescribeJobRun: (...args: unknown[]) => useDescribeJobRun(...args),
  useVirtualClusters: (...args: unknown[]) => useVirtualClusters(...args)
}));

vi.mock("@/hooks/useAwsSettings", () => ({
  useActiveAwsAccount: () => ({
    data: { id: "acct-test", name: "Test", region: "us-east-1", accessKeyIdMasked: "AKIA****", isActive: true }
  })
}));

vi.mock("@/hooks/useLogs", () => ({
  useJobLogStreams: (...args: unknown[]) => useJobLogStreams(...args),
  useJobLogs: (...args: unknown[]) => useJobLogs(...args),
  useS3JobLogObjects: (...args: unknown[]) => useS3JobLogObjects(...args),
  useS3JobLogObject: (...args: unknown[]) => useS3JobLogObject(...args)
}));

vi.mock("@/services/cloudWatchLogsService", () => ({
  cloudWatchLogsService: {
    getJobLogs: (...args: unknown[]) => getJobLogs(...args)
  }
}));

vi.mock("@/services/s3Service", () => ({
  s3Service: {
    getJobLogObject: (...args: unknown[]) => getJobLogObject(...args)
  }
}));

describe("LogsPage", () => {
  beforeEach(() => {
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
      selectedVirtualClusterId: "vc-1",
      selectedS3Bucket: undefined,
      selectedS3Prefix: undefined
    });
    window.localStorage.removeItem("emr-eks:logs-job-id-search-recent:acct-test");
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
          },
          {
            source: "cloudwatch",
            id: "cw-driver-stderr",
            label: "driver stderr",
            type: "driver",
            container: "spark-app",
            pod: "driver",
            stream: "stderr",
            cloudWatchStreamName: "20260612/vc-1/jobs/job-running/containers/spark-app/driver/stderr"
          }
        ]
      },
      isLoading: false,
      error: null
    });
    useJobLogs.mockReturnValue({
      data: {
        jobId: "job-running",
        entries: [
          { timestamp: "2026-06-10T00:00:00Z", level: "info", message: "hello cloudwatch", streamName: "cw" },
          { timestamp: "2026-06-10T00:00:01Z", level: "warn", message: "  indented cloudwatch", streamName: "cw" },
          { timestamp: "2026-06-10T00:00:02Z", level: "info", message: "", streamName: "cw" }
        ]
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
      data: { bucket: "logs-bucket", key: "stdout.gz", content: "hello s3\nneedle one\nNeedle two\n" },
      isLoading: false,
      error: null
    });
    getJobLogs.mockImplementation(async (request) => ({
      jobId: "job-running",
      entries: [
        {
          timestamp: "2026-06-10T00:00:00Z",
          level: "info",
          message: `downloaded ${request.logStreamName}`,
          streamName: request.logStreamName
        }
      ]
    }));
    getJobLogObject.mockImplementation(async (_accountId, _bucket, key) => ({
      bucket: "logs-bucket",
      key,
      content: `downloaded ${key}`
    }));
    saveTextFile.mockResolvedValue("/tmp/job-running-driver-stdout.log");
    useVirtualClusters.mockReturnValue({
      data: {
        clusters: [
          { id: "vc-1", name: "Cluster One", state: "RUNNING" },
          { id: "current-vc", name: "Current Cluster", state: "RUNNING" }
        ]
      },
      isLoading: false,
      error: null
    });
    useEffectiveVirtualClusterId.mockReturnValue("vc-1");
  });

  it("lets users enter a job id directly and view its logs in the selected virtual cluster", async () => {
    const user = userEvent.setup();
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();

    await user.type(screen.getByPlaceholderText(/Enter job id/i), "job-manual{Enter}");

    await waitFor(() => expect(useSessionStore.getState().selectedJobId).toBe("job-manual"));
    expect(useSessionStore.getState().selectedJobVirtualClusterId).toBe("vc-1");
    expect(useDescribeJobRun).toHaveBeenLastCalledWith("job-manual", "vc-1");
    expect(JSON.parse(window.localStorage.getItem("emr-eks:logs-job-id-search-recent:acct-test")!)).toEqual(["job-manual"]);
  });

  it("focuses the job id input with Mod+F when no log viewer is open", async () => {
    const user = userEvent.setup();
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();

    const input = screen.getByPlaceholderText(/Enter job id/i);
    expect(input).not.toHaveFocus();

    await user.keyboard("{Meta>}f{/Meta}");

    expect(input).toHaveFocus();
  });

  it("shows recent job ids on click and applies one immediately", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "emr-eks:logs-job-id-search-recent:acct-test",
      JSON.stringify(["job-from-history", "job-other"])
    );
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();
    const input = screen.getByPlaceholderText(/Enter job id/i);
    await user.click(input);
    const dropdown = await screen.findByRole("listbox", { name: /Recent job ids/i });
    expect(within(dropdown).getByRole("button", { name: "job-from-history" })).toBeInTheDocument();
    await user.click(within(dropdown).getByRole("button", { name: "job-from-history" }));

    await waitFor(() => expect(useSessionStore.getState().selectedJobId).toBe("job-from-history"));
    expect(useSessionStore.getState().selectedJobVirtualClusterId).toBe("vc-1");
  });

  it("shows recently viewed jobs in the empty state and opens logs on click", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "emr-eks:logs-job-id-search-recent:acct-test",
      JSON.stringify(["job-from-history", "job-other"])
    );
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();

    expect(
      screen.getByText(/Select a job from Job History or enter a job id to view logs/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Recently viewed")).toBeInTheDocument();
    const recentList = screen.getByRole("list", { name: /Recently viewed job ids/i });
    expect(within(recentList).getByRole("button", { name: "job-from-history" })).toBeInTheDocument();
    expect(within(recentList).getByRole("button", { name: "job-other" })).toBeInTheDocument();

    await user.click(within(recentList).getByRole("button", { name: "job-other" }));

    await waitFor(() => expect(useSessionStore.getState().selectedJobId).toBe("job-other"));
    expect(useSessionStore.getState().selectedJobVirtualClusterId).toBe("vc-1");
    expect(screen.queryByText("Recently viewed")).not.toBeInTheDocument();
  });

  it("hides recently viewed section when history is empty", () => {
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();

    expect(
      screen.getByText(/Select a job from Job History or enter a job id to view logs/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("Recently viewed")).not.toBeInTheDocument();
  });

  it("ignores legacy global recently viewed history", () => {
    window.localStorage.setItem(
      "emr-eks:logs-job-id-search-recent",
      JSON.stringify(["legacy-job"])
    );
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();

    expect(screen.queryByText("Recently viewed")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("emr-eks:logs-job-id-search-recent")).toBeNull();
  });

  it("keeps recently viewed history separate per account", async () => {
    window.localStorage.setItem(
      "emr-eks:logs-job-id-search-recent:acct-test",
      JSON.stringify(["job-for-test-account"])
    );
    window.localStorage.setItem(
      "emr-eks:logs-job-id-search-recent:acct-other",
      JSON.stringify(["job-for-other-account"])
    );
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();

    const recentList = screen.getByRole("list", { name: /Recently viewed job ids/i });
    expect(within(recentList).getByRole("button", { name: "job-for-test-account" })).toBeInTheDocument();
    expect(within(recentList).queryByRole("button", { name: "job-for-other-account" })).not.toBeInTheDocument();
  });

  it("reopens recent job ids when clicking an already focused input", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "emr-eks:logs-job-id-search-recent:acct-test",
      JSON.stringify(["job-from-history"])
    );
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();
    const input = screen.getByPlaceholderText(/Enter job id/i);
    await user.click(input);
    expect(await screen.findByRole("listbox", { name: /Recent job ids/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: /Recent job ids/i })).not.toBeInTheDocument();
    await user.click(input);
    expect(await screen.findByRole("listbox", { name: /Recent job ids/i })).toBeInTheDocument();
  });

  it("strips spark- before opening logs for a job id", async () => {
    const user = userEvent.setup();
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();
    await user.type(screen.getByPlaceholderText(/Enter job id/i), "spark-000000037tga8qam664{Enter}");

    await waitFor(() => expect(useSessionStore.getState().selectedJobId).toBe("000000037tga8qam664"));
    expect(useDescribeJobRun).toHaveBeenLastCalledWith("000000037tga8qam664", "vc-1");
  });

  it("records job ids opened from Job History into logs search history", async () => {
    const user = userEvent.setup();
    useSessionStore.setState({
      selectedJobId: undefined,
      selectedJobVirtualClusterId: undefined,
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();
    expect(window.localStorage.getItem("emr-eks:logs-job-id-search-recent:acct-test")).toBeNull();

    useSessionStore.getState().setSelectedJobForLogs("job-from-history-page", "vc-1");

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("emr-eks:logs-job-id-search-recent:acct-test")!)).toEqual([
        "job-from-history-page"
      ])
    );

    const input = screen.getByPlaceholderText(/Enter job id/i);
    await user.click(input);
    const dropdown = await screen.findByRole("listbox", { name: /Recent job ids/i });
    expect(within(dropdown).getByRole("button", { name: "job-from-history-page" })).toBeInTheDocument();
  });

  it("uses the effective virtual cluster for manual job entry submit", async () => {
    const user = userEvent.setup();
    useEffectiveVirtualClusterId.mockReturnValue("current-vc");
    useSessionStore.setState({
      selectedJobId: "old-job",
      selectedJobVirtualClusterId: "stale-vc",
      selectedVirtualClusterId: "current-vc"
    });

    renderLogsPage();

    expect(screen.getByTestId("virtual-cluster-select")).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText(/Enter job id/i));
    await user.type(screen.getByPlaceholderText(/Enter job id/i), "job-manual{Enter}");

    await waitFor(() => expect(useSessionStore.getState().selectedJobId).toBe("job-manual"));
    expect(useSessionStore.getState().selectedJobVirtualClusterId).toBe("current-vc");
  });

  it("auto-selects virtual cluster from navigation when the cluster exists in the list", async () => {
    useSessionStore.setState({
      selectedJobId: "job-running",
      selectedJobVirtualClusterId: "vc-1",
      selectedVirtualClusterId: undefined
    });

    renderLogsPage();

    await waitFor(() => expect(useSessionStore.getState().selectedVirtualClusterId).toBe("vc-1"));
  });

  it("does not auto-select virtual cluster when navigation cluster is missing from the list", async () => {
    useSessionStore.setState({
      selectedJobId: "job-running",
      selectedJobVirtualClusterId: "missing-vc",
      selectedVirtualClusterId: "vc-1"
    });

    renderLogsPage();

    expect(useSessionStore.getState().selectedVirtualClusterId).toBe("vc-1");
  });

  it("resolves destinations from describe, defaults to S3, and keeps CloudWatch as a tab", async () => {
    const user = userEvent.setup();

    renderLogsPage();

    expect(useDescribeJobRun).toHaveBeenCalledWith("job-running", "vc-1");
    expect(useJobLogStreams).not.toHaveBeenCalled();
    expect(useS3JobLogObjects).toHaveBeenCalledWith({
      bucket: "logs-bucket",
      prefix: "logs/vc-1/jobs/job-running/"
    });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["S3", "CloudWatch"]);
    expect(screen.getByRole("tab", { name: /^S3$/i })).toHaveAttribute("aria-selected", "true");
    await openDestinationPopover(user);
    expect(screen.getByText("s3://logs-bucket/logs/vc-1/jobs/job-running/")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: /^CloudWatch$/i }));
    expect(useJobLogStreams).toHaveBeenCalledWith({
      jobId: "job-running",
      logGroupName: "/emr-containers/jobs",
      streamNamePrefix: "20260612/vc-1/jobs/job-running/"
    });
    await openDestinationPopover(user);
    expect(screen.getByText("/emr-containers/jobs")).toBeInTheDocument();
    expect(screen.getByText("20260612/vc-1/jobs/job-running/")).toBeInTheDocument();
  });

  it("defaults to driver stderr instead of the first returned log item", async () => {
    const user = userEvent.setup();
    const driverStderrKey = "logs/vc-1/jobs/job-running/containers/spark-app/driver/stderr.gz";
    const execStderrKey =
      "logs/vc-1/jobs/job-running/containers/spark-app/spark-000000037lsld3h8l1d-77fab59ebcabdbc6-exec-1/stderr.gz";

    useS3JobLogObjects.mockReturnValue({
      data: {
        bucket: "logs-bucket",
        objects: [
          {
            source: "s3",
            id: "s3-exec-stderr",
            label: "exec-1 stderr",
            type: "executor",
            container: "spark-app",
            pod: "spark-000000037lsld3h8l1d-77fab59ebcabdbc6-exec-1",
            stream: "stderr",
            s3Key: execStderrKey,
            size: 456
          },
          {
            source: "s3",
            id: "s3-driver-stderr",
            label: "driver stderr",
            type: "driver",
            container: "spark-app",
            pod: "driver",
            stream: "stderr",
            s3Key: driverStderrKey,
            size: 789
          },
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

    renderLogsPage();

    await waitFor(() => expect(useS3JobLogObject).toHaveBeenCalledWith("logs-bucket", driverStderrKey));
    expect(useS3JobLogObject).not.toHaveBeenCalledWith("logs-bucket", execStderrKey);

    await user.click(screen.getByRole("tab", { name: /^CloudWatch$/i }));

    await waitFor(() =>
      expect(useJobLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          logStreamName: "20260612/vc-1/jobs/job-running/containers/spark-app/driver/stderr"
        })
      )
    );
  });

  it("removes low-value controls and manual CloudWatch inputs", () => {
    renderLogsPage();

    expect(screen.queryByPlaceholderText(/Search log text/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download Current Log/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Manual CloudWatch log group/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Job-level stream prefix/i)).not.toBeInTheDocument();
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

    expect(screen.getByRole("tab", { name: /^S3$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^CloudWatch$/i })).toBeDisabled();
    expect(useS3JobLogObjects).toHaveBeenCalledWith({
      bucket: "logs-bucket",
      prefix: "logs/vc-1/jobs/job-running/"
    });
  });

  it("uses the default CloudWatch destination when monitoring config is absent", async () => {
    const user = userEvent.setup();
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

    expect(screen.getByRole("tab", { name: /^CloudWatch$/i })).toHaveAttribute("aria-selected", "true");
    await openDestinationPopover(user);
    expect(screen.getByText("/aws/emr-containers/jobs/job-running")).toBeInTheDocument();
    expect(screen.getByText("job-running")).toBeInTheDocument();
  });

  it("downloads the selected CloudWatch log from the title icon", async () => {
    const user = userEvent.setup();

    renderLogsPage();

    await user.click(screen.getByRole("tab", { name: /^CloudWatch$/i }));
    await user.click(screen.getByRole("button", { name: /stdout/i }));
    await user.click(screen.getByRole("button", { name: /Download selected log/i }));

    expect(saveTextFile).toHaveBeenCalledWith(
      "job-running-driver stdout.log",
      [
        "20260612/vc-1/jobs/job-running/containers/spark-app/driver/stdout",
        "downloaded 20260612/vc-1/jobs/job-running/containers/spark-app/driver/stdout"
      ].join("\n")
    );
  });

  it("downloads all CloudWatch pages for the selected log item", async () => {
    const user = userEvent.setup();
    getJobLogs
      .mockResolvedValueOnce({
        jobId: "job-running",
        nextForwardToken: "page-2",
        entries: [{ timestamp: "2026-06-10T00:00:00Z", level: "info", message: "first page", streamName: "cw" }]
      })
      .mockResolvedValueOnce({
        jobId: "job-running",
        entries: [{ timestamp: "2026-06-10T00:00:01Z", level: "info", message: "second page", streamName: "cw" }]
      });

    renderLogsPage();

    await user.click(screen.getByRole("tab", { name: /^CloudWatch$/i }));
    await user.click(screen.getByRole("button", { name: /stdout/i }));
    await user.click(screen.getByRole("button", { name: /Download selected log/i }));

    expect(getJobLogs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nextForwardToken: "page-2"
      })
    );
    expect(saveTextFile).toHaveBeenCalledWith(
      "job-running-driver stdout.log",
      expect.stringContaining("first page")
    );
    expect(saveTextFile).toHaveBeenCalledWith(
      "job-running-driver stdout.log",
      expect.stringContaining("second page")
    );
  });

  it("does not open a right-click download menu for log items or groups", () => {
    renderLogsPage();

    fireEvent.contextMenu(screen.getByRole("button", { name: /stdout/i }));
    fireEvent.contextMenu(screen.getByRole("navigation", { name: "Log files" }));

    expect(screen.queryByRole("menuitem", { name: /Download logs/i })).not.toBeInTheDocument();
  });

  it("downloads the selected S3 log object from the title icon", async () => {
    const user = userEvent.setup();

    renderLogsPage();

    await waitFor(() => expect(screen.getByTestId("log-content").textContent).toContain("hello s3"));
    await user.click(screen.getByRole("button", { name: /Download selected log/i }));

    expect(getJobLogObject).toHaveBeenCalledWith(
      "acct-test",
      "logs-bucket",
      "logs/vc-1/jobs/job-running/containers/spark-app/driver/stdout.gz"
    );
    expect(saveTextFile).toHaveBeenCalledWith(
      "job-running-driver stdout.log",
      expect.stringContaining("downloaded logs/vc-1/jobs/job-running")
    );
  });

  it("renders CloudWatch messages without event time or level while preserving message whitespace", async () => {
    const user = userEvent.setup();

    renderLogsPage();

    await user.click(screen.getByRole("tab", { name: /^CloudWatch$/i }));
    await user.click(screen.getByRole("button", { name: /stdout/i }));

    expect(screen.getByTestId("log-content").textContent).toBe("hello cloudwatch\n  indented cloudwatch\n");
  });

  it("collapses the log files panel by default and toggles with Cmd+\\", async () => {
    const user = userEvent.setup();

    renderLogsPage();

    expect(screen.getByRole("button", { name: /Expand log files panel/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Collapse log files panel/i })).not.toBeInTheDocument();
    const logFilesNav = screen.getByRole("navigation", { name: "Log files" });
    expect(within(logFilesNav).getByText("driver")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /driver stdout/i })).toBeInTheDocument();

    await user.keyboard("{Meta>}\\{/Meta}");

    expect(screen.getByRole("button", { name: /Collapse log files panel/i })).toBeInTheDocument();
    expect(screen.getByText("Log files")).toBeInTheDocument();
    expect(screen.getAllByText("stdout").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Collapse log files panel/i }));
    expect(screen.getByRole("button", { name: /Expand log files panel/i })).toBeInTheDocument();
  });

  it("opens find with Cmd+F, defaults to regex, and supports Enter plus next/previous navigation", async () => {
    const user = userEvent.setup();

    renderLogsPage();

    await waitFor(() => expect(screen.getByTestId("log-content").textContent).toContain("hello s3"));

    expect(screen.queryByTestId("log-find-bar")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Hide noisy Spark log lines/i })).toBeChecked();

    await user.keyboard("{Meta>}f{/Meta}");

    const findBar = screen.getByTestId("log-find-bar");
    expect(findBar).toBeInTheDocument();
    const searchInput = within(findBar).getByRole("textbox", { name: /Find in current log/i });
    expect(within(findBar).getByRole("checkbox", { name: /^Regex$/i })).toBeChecked();
    expect(within(findBar).getByText("0 results")).toBeInTheDocument();

    await user.type(searchInput, "needle\\s+(one|two)");
    expect(screen.queryAllByTestId("log-search-match")).toHaveLength(0);

    await user.keyboard("{Enter}");
    expect(within(findBar).getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getAllByTestId("log-search-match")).toHaveLength(2);

    await user.keyboard("{Enter}");
    expect(within(findBar).getByText("2 / 2")).toBeInTheDocument();

    await user.click(within(findBar).getByRole("button", { name: /Previous match/i }));
    expect(within(findBar).getByText("1 / 2")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("log-find-bar")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("log-search-match")).toHaveLength(0);

    await user.keyboard("{Meta>}f{/Meta}");
    expect(screen.getByTestId("log-find-bar")).toBeInTheDocument();
    await user.keyboard("{Meta>}f{/Meta}");
    expect(screen.queryByTestId("log-find-bar")).not.toBeInTheDocument();
  });

  it("Focus hides Spark noise from the viewer and search, while download stays raw", async () => {
    const user = userEvent.setup();
    const rawLog = [
      "26/07/31 11:30:32 INFO TaskSetManager: Starting task UNIQUE_NOISE_TOKEN",
      "26/07/31 11:30:32 INFO ETLLogger: Executing job dct__demo"
    ].join("\n");

    useS3JobLogObject.mockReturnValue({
      data: { bucket: "logs-bucket", key: "stdout.gz", content: rawLog },
      isLoading: false,
      error: null
    });
    getJobLogObject.mockResolvedValue({
      bucket: "logs-bucket",
      key: "stdout.gz",
      content: rawLog
    });

    renderLogsPage();

    await waitFor(() => expect(screen.getByTestId("log-content").textContent).toContain("ETLLogger"));
    expect(screen.getByTestId("log-content").textContent).not.toContain("UNIQUE_NOISE_TOKEN");
    expect(screen.getByTestId("hidden-noise-count")).toHaveTextContent("Hidden 1 lines");

    await user.keyboard("{Meta>}f{/Meta}");
    const findBar = screen.getByTestId("log-find-bar");
    const searchInput = within(findBar).getByRole("textbox", { name: /Find in current log/i });
    await user.type(searchInput, "UNIQUE_NOISE_TOKEN");
    await user.keyboard("{Enter}");
    expect(within(findBar).getByText("0 results")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Hide noisy Spark log lines/i }));
    expect(screen.getByTestId("log-content").textContent).toContain("UNIQUE_NOISE_TOKEN");

    await user.clear(searchInput);
    await user.type(searchInput, "UNIQUE_NOISE_TOKEN");
    await user.keyboard("{Enter}");
    expect(screen.getAllByTestId("log-search-match").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Download selected log/i }));
    await waitFor(() =>
      expect(saveTextFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("UNIQUE_NOISE_TOKEN")
      )
    );
  });

  it("shows a readable truncation banner with load-full and download actions", async () => {
    const longContent = "x".repeat(MAX_LOG_VIEW_CHARACTERS + 100);
    useS3JobLogObject.mockReturnValue({
      data: { bucket: "logs-bucket", key: "stdout.gz", content: longContent },
      isLoading: false,
      error: null
    });

    renderLogsPage();

    await waitFor(() => expect(screen.getByTestId("log-content").textContent).toHaveLength(MAX_LOG_VIEW_CHARACTERS));

    expect(screen.getByText(/Previewing the first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load full log/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Download$/i }).length).toBeGreaterThan(0);
    expect(screen.getByTestId("log-content").textContent).toHaveLength(MAX_LOG_VIEW_CHARACTERS);

    await userEvent.setup().click(screen.getByRole("button", { name: /Load full log/i }));

    expect(screen.getByText(/Showing the full log/i)).toBeInTheDocument();
    expect(screen.getByTestId("log-content").textContent).toHaveLength(longContent.length);
  });
});

async function openDestinationPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Log destination details/i }));
}

function renderLogsPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <LogsPage />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
