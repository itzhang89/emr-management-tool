import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VirtualClustersPage } from "@/pages/VirtualClustersPage";

vi.mock("@/hooks/useEmr", () => ({
  useVirtualClusters: () => ({
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
  })
}));

describe("VirtualClustersPage", () => {
  it("opens a details dialog from a cluster row", async () => {
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
});
