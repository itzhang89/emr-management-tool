import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VirtualClustersPage } from "@/pages/VirtualClustersPage";

const useVirtualClusters = vi.fn();

vi.mock("@/hooks/useEmr", () => ({
  useVirtualClusters: (...args: unknown[]) => useVirtualClusters(...args)
}));

vi.mock("@/hooks/useAwsSettings", () => ({
  useActiveAwsAccount: () => ({
    data: {
      id: "acct-test",
      name: "ruikai-cyprus",
      region: "eu-west-1",
      accessKeyIdMasked: "AKIA****",
      isActive: true,
      identity: { account: "381492159467", arn: "arn:aws:iam::381492159467:user/ruikaili", userId: "x" }
    }
  })
}));

describe("VirtualClustersPage", () => {
  it("opens a details dialog from a cluster row", async () => {
    useVirtualClusters.mockReturnValue({
      data: {
        clusters: [
          {
            id: "vc-1",
            name: "analytics",
            state: "RUNNING",
            namespace: "spark",
            eksClusterName: "eks-prod",
            createdAt: "2026-06-10T00:00:00Z"
          }
        ]
      },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });
    const user = userEvent.setup();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <VirtualClustersPage />
      </QueryClientProvider>
    );

    await user.click(within(screen.getByRole("row", { name: /analytics RUNNING/i })).getByRole("button", { name: /View Details/i }));

    const dialog = screen.getByRole("dialog", { name: /Virtual Cluster Details/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("vc-1")).toBeInTheDocument();
    expect(within(dialog).getByText("eks-prod")).toBeInTheDocument();
  });

  it("shows a region-focused hint when the API returns an empty cluster list", () => {
    useVirtualClusters.mockReturnValue({
      data: { clusters: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <VirtualClustersPage />
      </QueryClientProvider>
    );

    expect(screen.getByText(/No virtual clusters in eu-west-1/i)).toBeInTheDocument();
    expect(screen.getByText(/region configured for this account/i)).toBeInTheDocument();
    expect(screen.getByText("ruikai-cyprus")).toBeInTheDocument();
  });
});
