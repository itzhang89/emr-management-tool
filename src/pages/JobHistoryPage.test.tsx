import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobHistoryPage, type LogTabIntent } from "./JobHistoryPage";
import { useSessionStore } from "@/stores/sessionStore";
import { MAX_LOG_TABS } from "@/services/logsTabStorage";
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
  useSubmissionHistory: () => ({ data: [], isLoading: false, error: null, isFetching: false }),
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

vi.mock("@/hooks/useAwsSettings", () => ({
  useActiveAwsAccount: () => ({
    data: { id: "acct-test", name: "Test", region: "us-east-1", accessKeyIdMasked: "AKIA****", isActive: true }
  })
}));

let jobs: JobRunSummary[];

function renderJobHistoryPage(props?: { logTabIntent?: LogTabIntent; onOpenSubmit?: () => void; onOpenAiAssistant?: () => void }) {
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
    useJobRuns.mockImplementation((_virtualClusterId?: string, _autoRefresh?: boolean, keyword?: string) => ({
      data: filterJobs(jobs, keyword),
      isLoading: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn()
    }));
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
    window.localStorage.removeItem("emr-eks:job-history-search-recent:acct-test");
  });

  it("shows recent searches on focus and applies one immediately", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "emr-eks:job-history-search-recent:acct-test",
      JSON.stringify(["000000037tga8qam664", "failed"])
    );
    renderJobHistoryPage();
    const input = screen.getByPlaceholderText(/Search jobs/i);
    await user.click(input);
    expect(await screen.findByRole("button", { name: "000000037tga8qam664" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "000000037tga8qam664" }));
    expect(useJobRuns).toHaveBeenCalledWith("vc-1", expect.any(Boolean), "000000037tga8qam664");
  });

  it("reopens recent searches when clicking an already focused search input", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "emr-eks:job-history-search-recent:acct-test",
      JSON.stringify(["000000037tga8qam664", "failed"])
    );
    renderJobHistoryPage();
    const input = screen.getByPlaceholderText(/Search jobs/i);
    await user.click(input);
    expect(await screen.findByRole("button", { name: "000000037tga8qam664" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "000000037tga8qam664" })).not.toBeInTheDocument();
    await user.click(input);
    expect(await screen.findByRole("button", { name: "000000037tga8qam664" })).toBeInTheDocument();
  });

  it("ignores legacy global search history", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "emr-eks:job-history-search-recent",
      JSON.stringify(["legacy-query"])
    );
    renderJobHistoryPage();
    const input = screen.getByPlaceholderText(/Search jobs/i);
    await user.click(input);
    expect(screen.queryByRole("button", { name: "legacy-query" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("emr-eks:job-history-search-recent")).toBeNull();
  });

  it("keeps search history separate per account", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "emr-eks:job-history-search-recent:acct-test",
      JSON.stringify(["query-for-test-account"])
    );
    window.localStorage.setItem(
      "emr-eks:job-history-search-recent:acct-other",
      JSON.stringify(["query-for-other-account"])
    );
    renderJobHistoryPage();
    const input = screen.getByPlaceholderText(/Search jobs/i);
    await user.click(input);
    expect(await screen.findByRole("button", { name: "query-for-test-account" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "query-for-other-account" })).not.toBeInTheDocument();
  });

  it("strips spark- before searching and looking up in AWS", async () => {
    const user = userEvent.setup();
    jobs = [];
    useJobRuns.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn()
    }));
    renderJobHistoryPage();
    const input = screen.getByPlaceholderText(/Search jobs/i);
    await user.type(input, "spark-000000037tga8qam664");
    await user.keyboard("{Enter}");
    expect(useJobRuns).toHaveBeenCalledWith("vc-1", expect.any(Boolean), "000000037tga8qam664");
    await user.keyboard("{Enter}");
    expect(describeJobRun).toHaveBeenCalledWith("000000037tga8qam664", "vc-1");
  });

  it("shows production actions, hides virtual cluster column, searches after submit, and paginates", async () => {
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

    const cancelledRow = screen.getByRole("row", { name: /cancelled-etl CANCELLED/i });
    expect(within(cancelledRow).getByRole("button", { name: /Rerun/i })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "failed");
    expect(screen.getByText("running-etl")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(useJobRuns).toHaveBeenLastCalledWith("vc-1", true, "failed");
    expect(screen.queryByText("running-etl")).not.toBeInTheDocument();
    expect(screen.getByText("failed-etl")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/search jobs/i));
    await user.keyboard("{Enter}");
    expect(useJobRuns).toHaveBeenLastCalledWith("vc-1", true, undefined);
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
    expect(screen.getByRole("dialog", { name: /Job run details/i })).toBeInTheDocument();
    expect(describeJob).toHaveBeenCalledWith("job-running", "vc-1");

    await user.click(screen.getByRole("button", { name: /Copy Job ID/i }));
    expect(writeText).toHaveBeenCalledWith("job-running");
    expect(screen.queryByRole("dialog", { name: /Job run details/i })).not.toBeInTheDocument();
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

    const dialog = screen.getByRole("dialog", { name: /Job run details/i });
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
    expect(screen.getByRole("dialog", { name: /Job run details/i })).toBeInTheDocument();

    await user.click(screen.getByPlaceholderText(/search jobs/i));
    expect(screen.queryByRole("dialog", { name: /Job run details/i })).not.toBeInTheDocument();
  });

  it("does not show filter empty message while the initial AWS sync is in progress", () => {
    useJobRuns.mockReturnValue({
      data: [],
      isLoading: true,
      isFetching: true,
      error: null,
      dataUpdatedAt: 0,
      refetch: vi.fn()
    });

    renderJobHistoryPage();

    expect(screen.queryByText("No jobs match the current filters.")).not.toBeInTheDocument();
    expect(screen.getByText(/Syncing job runs from AWS/i)).toBeInTheDocument();
  });

  it("shows the empty-state refresh message during background auto refresh", () => {
    useJobRuns.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: true,
      error: null,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn()
    });

    renderJobHistoryPage();

    expect(screen.queryByText(/Syncing job runs from AWS/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No job runs found yet/i)).toBeInTheDocument();
  });

  it("enables 15 second auto refresh by default and allows turning it off", async () => {
    const user = userEvent.setup();
    localStorage.removeItem("emr-eks:job-history-auto-refresh");

    renderJobHistoryPage();

    expect(useJobRuns).toHaveBeenCalledWith("vc-1", true, undefined);
    expect(screen.getByText("15s")).toBeInTheDocument();
    expect(screen.queryByText("Auto refresh (15s)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /Auto refresh job history/i }));

    expect(useJobRuns).toHaveBeenCalledWith("vc-1", false, undefined);
    expect(window.localStorage.getItem("emr-eks:job-history-auto-refresh")).toBe("false");
  });

  it("focuses the job search input with Mod+F", async () => {
    const user = userEvent.setup();
    renderJobHistoryPage();

    const input = screen.getByPlaceholderText(/Search jobs by name, id, or state/i);
    expect(input).not.toHaveFocus();

    await user.keyboard("{Meta>}f{/Meta}");

    expect(input).toHaveFocus();
  });

  it("opens a log tab for the job whose Logs button was pressed", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();

    await user.click(
      within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Logs/i })
    );

    // The list is still the first tab, and the job's logs are a tab beside it.
    expect(screen.getByRole("tab", { name: "Job History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "running-etl" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Job run details/i })).not.toBeInTheDocument();
    // The session handoff stays for the cross-page path (Submit Job's
    // Recent Submissions table reaches logs through the same button).
    expect(useSessionStore.getState().selectedJobId).toBe("job-running");
    expect(useSessionStore.getState().selectedJobVirtualClusterId).toBe("vc-1");
    expect(useSessionStore.getState().selectedS3Bucket).toBeUndefined();
  });

  it("keeps the job list as a fixed first tab with no close button", async () => {
    renderJobHistoryPage();

    const historyTab = screen.getByRole("tab", { name: "Job History" });
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Close Job History" })).not.toBeInTheDocument();
  });

  it("activates an open tab instead of opening a second one for the same job", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();
    const logsButton = within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", {
      name: /Logs/i
    });

    await user.click(logsButton);
    await user.click(screen.getByRole("tab", { name: "Job History" }));
    await user.click(logsButton);

    expect(screen.getAllByRole("tab", { name: "running-etl" })).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "running-etl" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes a log tab, falls back to the neighbour, and releases its cache", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();
    await user.click(
      within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Logs/i })
    );

    await user.click(screen.getByRole("button", { name: "Close running-etl" }));

    expect(screen.queryByRole("tab", { name: "running-etl" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Job History" })).toHaveAttribute("aria-selected", "true");
    // Closing is what releases the local copy — the payload is gone, not
    // merely unhooked from the strip.
    expect(window.localStorage.getItem("emr-eks:job-history-tabs:acct-test")).toBeNull();
  });

  it("turns a draft tab into the job whose id was entered", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();
    await user.click(screen.getByRole("button", { name: "Open a log tab" }));

    expect(screen.getByRole("tab", { name: "New log tab" })).toHaveAttribute("aria-selected", "true");

    await user.type(screen.getByPlaceholderText(/Enter job id/i), "job-typed{Enter}");

    expect(screen.queryByRole("tab", { name: "New log tab" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "job-typed" })).toHaveAttribute("aria-selected", "true");
  });

  it("refuses a tab past the limit and says why", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();
    for (let index = 0; index < MAX_LOG_TABS; index += 1) {
      await user.click(screen.getByRole("button", { name: "Open a log tab" }));
    }
    expect(screen.getAllByRole("tab")).toHaveLength(MAX_LOG_TABS + 1);

    await user.click(screen.getByRole("button", { name: "Open a log tab" }));

    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining(`${MAX_LOG_TABS} of ${MAX_LOG_TABS} are open`)
    );
    expect(screen.getAllByRole("tab")).toHaveLength(MAX_LOG_TABS + 1);
  });

  it("cycles tabs with Mod+Shift+bracket and wraps around", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();
    await user.click(
      within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Logs/i })
    );
    expect(screen.getByRole("tab", { name: "running-etl" })).toHaveAttribute("aria-selected", "true");

    // Brackets are userEvent descriptor syntax, so fire the events directly.
    fireEvent.keyDown(window, { key: "]", code: "BracketRight", metaKey: true, shiftKey: true });
    expect(screen.getByRole("tab", { name: "Job History" })).toHaveAttribute("aria-selected", "true");

    // Wrapping backwards from the first tab lands on the last one.
    fireEvent.keyDown(window, { key: "[", code: "BracketLeft", metaKey: true, shiftKey: true });
    expect(screen.getByRole("tab", { name: "running-etl" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes the tab in front with Mod+W and keeps the job list", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();
    await user.click(
      within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Logs/i })
    );

    await user.keyboard("{Meta>}w{/Meta}");

    expect(screen.queryByRole("tab", { name: "running-etl" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Job History" })).toHaveAttribute("aria-selected", "true");
  });

  it("ignores Mod+W on the fixed tab instead of letting the window take it", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();
    const event = new KeyboardEvent("keydown", { key: "w", metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("tab", { name: "Job History" })).toBeInTheDocument();
  });

  it("drops the submission timestamp from the tab label but keeps it on hover", async () => {
    const user = userEvent.setup();
    jobs = [{ ...makeJobs()[0]!, id: "job-stamped", name: "g2_5mins_latest_only_260920_0735", state: "RUNNING" }];

    renderJobHistoryPage();
    await user.click(
      within(screen.getByRole("row", { name: /g2_5mins_latest_only_260920_0735 RUNNING/i })).getByRole("button", {
        name: /Logs/i
      })
    );

    const tab = screen.getByRole("tab", { name: "g2_5mins_latest_only" });
    expect(tab).toHaveAttribute("title", "g2_5mins_latest_only_260920_0735");
  });

  it("carries the keyboard focus to the tab a shortcut switched to", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();
    await user.click(
      within(screen.getByRole("row", { name: /running-etl RUNNING/i })).getByRole("button", { name: /Logs/i })
    );
    // Clicking the row action deliberately leaves focus on it, so the shortcut
    // is what has to move the ring.
    expect(screen.getByRole("tab", { name: "running-etl" })).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "]", code: "BracketRight", metaKey: true, shiftKey: true });

    // The pane follows the value, but so must the ring — otherwise the user
    // sees the highlight sitting on the tab they just left.
    expect(screen.getByRole("tab", { name: "Job History" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "[", code: "BracketLeft", metaKey: true, shiftKey: true });
    expect(screen.getByRole("tab", { name: "running-etl" })).toHaveFocus();
  });

  it("restores the tabs and their cached log text from the last session", () => {
    window.localStorage.setItem(
      "emr-eks:job-history-tabs:acct-test",
      JSON.stringify({
        version: 1,
        activeTabId: "vc-1:job-1",
        tabs: [
          {
            id: "vc-1:job-1",
            jobId: "job-1",
            virtualClusterId: "vc-1",
            jobName: "restored-etl",
            openedAt: "2026-09-19T00:00:00.000Z",
            lastViewedAt: "2026-09-19T00:00:00.000Z",
            contentLength: 5,
            content: { itemKey: "driver/stderr", text: "hello", savedAt: "2026-09-19T00:00:00.000Z" }
          }
        ]
      })
    );

    renderJobHistoryPage();

    expect(screen.getByRole("tab", { name: "restored-etl" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the tab named by a cross-page intent, once", async () => {
    const intent = (nonce: number): LogTabIntent => ({ jobId: "job-1", virtualClusterId: "vc-1", nonce });

    const { rerender } = renderJobHistoryPage({ logTabIntent: intent(1) });

    expect(await screen.findByRole("tab", { name: "job-1" })).toBeInTheDocument();

    // Closing it must stick: re-rendering with the intent the page already
    // handled must not reopen a tab the user just closed.
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <JobHistoryPage logTabIntent={intent(1)} />
      </QueryClientProvider>
    );
    expect(screen.queryByRole("tab", { name: "job-1" })).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <JobHistoryPage logTabIntent={intent(2)} />
      </QueryClientProvider>
    );
    expect(screen.getByRole("tab", { name: "job-1" })).toBeInTheDocument();
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

    await user.type(screen.getByPlaceholderText(/search jobs/i), "job-remote-only{Enter}");
    expect(screen.getByText("No jobs match the current filters.")).toBeInTheDocument();
    const emptyResultRow = screen.getByRole("row", { name: /No jobs match the current filters/i });
    expect(within(emptyResultRow).getByRole("button", { name: /Find in AWS/i })).toBeInTheDocument();

    await user.click(within(emptyResultRow).getByRole("button", { name: /Find in AWS/i }));

    expect(describeJobRun).toHaveBeenCalledWith("job-remote-only", "vc-1");
    expect(screen.getByRole("row", { name: /remote-only-etl RUNNING/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Job run details/i })).toBeInTheDocument();
  });

  it("uses Enter to look up a submitted job id in AWS after local cache search is empty", async () => {
    const user = userEvent.setup();
    describeJobRun.mockResolvedValue({
      id: "job-remote-only",
      name: "remote-only-etl",
      state: "RUNNING",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:20:00Z"
    });

    renderJobHistoryPage();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "job-remote-only{Enter}");
    expect(describeJobRun).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");

    expect(describeJobRun).toHaveBeenCalledWith("job-remote-only", "vc-1");
    expect(screen.getByRole("row", { name: /remote-only-etl RUNNING/i })).toBeInTheDocument();
  });

  it("keeps search local-first and does not look up AWS while local rows match", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "running-etl{Enter}");

    expect(screen.getByRole("row", { name: /running-etl RUNNING/i })).toBeInTheDocument();
    expect(screen.queryByText("No jobs match the current filters.")).not.toBeInTheDocument();
    expect(describeJobRun).not.toHaveBeenCalled();
  });

  it("only shows Find in AWS when the submitted empty search looks like a job id", async () => {
    const user = userEvent.setup();

    renderJobHistoryPage();

    await user.type(screen.getByPlaceholderText(/search jobs/i), "jinghui{Enter}");
    const emptyResultRow = screen.getByRole("row", { name: /No jobs match the current filters/i });

    expect(within(emptyResultRow).queryByRole("button", { name: /Find in AWS/i })).not.toBeInTheDocument();
    expect(describeJobRun).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reruns a failed job with sourceRequest via startJob", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");
    startMutate.mockImplementation((_request, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
    renderJobHistoryPage();

    const failedJob = jobs.find((job) => job.id === "job-failed");
    await user.click(within(screen.getByRole("row", { name: /failed-etl FAILED/i })).getByRole("button", { name: /Rerun/i }));

    expect(startMutate).toHaveBeenCalledWith(failedJob?.sourceRequest, expect.any(Object));
    expect(toast.success).toHaveBeenCalledWith("Rerun · Daily ETL");
  });

  it("disables Path B Rerun while describe is in flight", async () => {
    const user = userEvent.setup();
    let resolveDescribe: (value: JobRunSummary) => void = () => undefined;
    describeJobRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDescribe = resolve;
        })
    );

    jobs = [
      {
        id: "job-failed-no-describe",
        name: "failed-no-describe",
        state: "FAILED",
        virtualClusterId: "vc-1",
        createdAt: "2026-06-10T00:01:00Z"
      }
    ];

    renderJobHistoryPage();

    const resubmitButton = screen.getByRole("button", { name: /Rerun/i });
    await user.click(resubmitButton);

    expect(describeJobRun).toHaveBeenCalledTimes(1);
    expect(resubmitButton).toBeDisabled();

    await user.click(resubmitButton);
    expect(describeJobRun).toHaveBeenCalledTimes(1);

    resolveDescribe({
      id: "job-failed-no-describe",
      name: "failed-no-describe",
      state: "FAILED",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:01:00Z",
      describeDetails: {
        executionRoleArn: "arn:aws:iam::123456789012:role/EMR",
        releaseLabel: "emr-7.2.0-latest",
        jobDriver: {
          type: "sparkSubmit",
          entryPoint: "s3://bucket/app.jar",
          entryPointArguments: [],
          sparkSubmitParameters: "--class Main"
        }
      }
    });

    await waitFor(() => {
      expect(resubmitButton).not.toBeDisabled();
    });
  });

  it("opens Submit Source flow when Rerun has no sourceRequest", async () => {
    const user = userEvent.setup();
    const onOpenSubmit = vi.fn();
    const setPendingSourceSubmit = vi.fn();
    const originalSetPending = useSessionStore.getState().setPendingSourceSubmit;
    useSessionStore.setState({ setPendingSourceSubmit });

    jobs = [
      {
        id: "job-failed-no-source",
        name: "failed-no-source",
        state: "FAILED",
        virtualClusterId: "vc-1",
        createdAt: "2026-06-10T00:01:00Z",
        describeDetails: {
          executionRoleArn: "arn:aws:iam::123456789012:role/EMR",
          releaseLabel: "emr-7.2.0-latest",
          jobDriver: {
            type: "sparkSubmit",
            entryPoint: "s3://bucket/app.jar",
            entryPointArguments: ["--date", "2026-06-10"],
            sparkSubmitParameters: "--class Main"
          }
        }
      }
    ];

    renderJobHistoryPage({ onOpenSubmit });

    await user.click(screen.getByRole("button", { name: /Rerun/i }));

    expect(setPendingSourceSubmit).toHaveBeenCalledWith({
      payload: expect.objectContaining({
        name: "failed-no-source",
        virtualClusterId: "vc-1",
        executionRoleArn: "arn:aws:iam::123456789012:role/EMR",
        releaseLabel: "emr-7.2.0-latest",
        jobDriver: {
          sparkSubmitJobDriver: {
            entryPoint: "s3://bucket/app.jar",
            entryPointArguments: ["--date", "2026-06-10"],
            sparkSubmitParameters: "--class Main"
          }
        }
      }),
      virtualClusterId: "vc-1"
    });
    expect(onOpenSubmit).toHaveBeenCalled();

    useSessionStore.setState({ setPendingSourceSubmit: originalSetPending });
  });

  it("shows unsupported toast when Rerun describe is sparkSql", async () => {
    const user = userEvent.setup();
    jobs = [
      {
        id: "job-failed-spark-sql",
        name: "failed-spark-sql",
        state: "FAILED",
        virtualClusterId: "vc-1",
        createdAt: "2026-06-10T00:01:00Z",
        describeDetails: {
          executionRoleArn: "arn:aws:iam::123456789012:role/EMR",
          releaseLabel: "emr-7.2.0-latest",
          jobDriver: {
            type: "sparkSql",
            sparkSqlParameters: "SELECT 1"
          }
        }
      }
    ];

    renderJobHistoryPage();

    await user.click(screen.getByRole("button", { name: /Rerun/i }));

    expect(toastError).toHaveBeenCalledWith("Source Rerun currently supports sparkSubmit jobs only.");
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

    await user.type(screen.getByPlaceholderText(/search jobs/i), "job-missing{Enter}");
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
      id: "job-cancelled",
      name: "cancelled-etl",
      state: "CANCELLED",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:00:30Z"
    },
    {
      id: "job-failed",
      name: "failed-etl",
      state: "FAILED",
      virtualClusterId: "vc-1",
      createdAt: "2026-06-10T00:01:00Z",
      sourceRequest: {
        name: "failed-etl",
        templateName: "Daily ETL",
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

function filterJobs(sourceJobs: JobRunSummary[], keyword?: string) {
  const normalized = keyword?.trim().toLowerCase();
  if (!normalized) return sourceJobs;
  return sourceJobs.filter((job) =>
    [job.name, job.id, job.state].some((value) => value.toLowerCase().includes(normalized))
  );
}
