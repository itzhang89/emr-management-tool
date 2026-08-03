import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/pages/DashboardPage";

const useJobRuns = vi.fn();
const useEffectiveVirtualClusterId = vi.fn();

vi.mock("@/hooks/useEmr", () => ({
  useJobRuns: (...args: unknown[]) => useJobRuns(...args)
}));

vi.mock("@/components/emr/VirtualClusterSelect", () => ({
  VirtualClusterSelect: () => <div data-testid="virtual-cluster-select">Virtual Cluster</div>,
  useEffectiveVirtualClusterId: () => useEffectiveVirtualClusterId()
}));

vi.mock("@/components/emr/JobRunsDailyChart", () => ({
  JobRunsDailyChart: ({ rangeDays, syncing }: { rangeDays: number; syncing?: boolean }) => (
    <div data-testid="daily-chart">
      daily-{rangeDays}
      {syncing ? " syncing" : ""}
    </div>
  )
}));

vi.mock("@/components/emr/JobRunsHourlyChart", () => ({
  JobRunsHourlyChart: ({ selectedDate }: { selectedDate: string }) => (
    <div data-testid="hourly-chart">hourly-{selectedDate}</div>
  )
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() }
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    useEffectiveVirtualClusterId.mockReturnValue("vc-1");
    useJobRuns.mockReturnValue({
      data: [
        {
          id: "job-1",
          name: "ok",
          state: "COMPLETED",
          virtualClusterId: "vc-1",
          createdAt: new Date().toISOString()
        },
        {
          id: "job-2",
          name: "bad",
          state: "FAILED",
          virtualClusterId: "vc-1",
          createdAt: new Date().toISOString()
        },
        {
          id: "job-3",
          name: "run",
          state: "RUNNING",
          virtualClusterId: "vc-1",
          createdAt: new Date().toISOString()
        }
      ],
      isFetching: false,
      error: null,
      dataUpdatedAt: Date.now()
    });
  });

  it("shows KPIs, default 7d range, and both charts", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Success Rate (7d)")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Failed (24h)")).toBeInTheDocument();
    expect(screen.getAllByText("1")).toHaveLength(2);
    expect(screen.getByTestId("daily-chart")).toHaveTextContent("daily-7");
    expect(screen.getByTestId("hourly-chart")).toBeInTheDocument();
    expect(screen.queryByText("Recent Jobs")).not.toBeInTheDocument();
    expect(useJobRuns).toHaveBeenCalledWith("vc-1", false, undefined, true, 7);
  });

  it("resyncs when the range control changes", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "15d" }));

    expect(useJobRuns).toHaveBeenLastCalledWith("vc-1", false, undefined, true, 15);
    expect(screen.getByTestId("daily-chart")).toHaveTextContent("daily-15");
    expect(screen.getByText("Success Rate (15d)")).toBeInTheDocument();
  });
});
