import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { s3Service } from "@/services/s3Service";
import { useS3Buckets, useS3Objects } from "./useS3";

vi.mock("@/hooks/useAwsSettings", () => ({
  useActiveAwsAccount: () => ({
    data: { id: "acct-a", name: "A", region: "us-east-1", accessKeyIdMasked: "AKIA****", isActive: true }
  })
}));

vi.mock("@/services/s3Service", () => ({
  s3Service: {
    listBuckets: vi.fn(),
    listObjects: vi.fn()
  }
}));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useS3 account scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes the active account id in S3 bucket query keys", async () => {
    vi.mocked(s3Service.listBuckets).mockResolvedValue([{ name: "logs-bucket" }]);
    const queryClient = new QueryClient();

    renderHook(() => useS3Buckets(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(queryClient.getQueryData(["s3-buckets", "acct-a"])).toEqual([{ name: "logs-bucket" }]));
    expect(s3Service.listBuckets).toHaveBeenCalledWith("acct-a");
  });

  it("includes the active account id in S3 object query keys and requests", async () => {
    vi.mocked(s3Service.listObjects).mockResolvedValue([]);
    const queryClient = new QueryClient();

    renderHook(() => useS3Objects("logs-bucket", "logs/"), { wrapper: wrapper(queryClient) });

    await waitFor(() =>
      expect(queryClient.getQueryData(["s3-objects", "acct-a", "logs-bucket", "logs/"])).toEqual([])
    );
    expect(s3Service.listObjects).toHaveBeenCalledWith("acct-a", "logs-bucket", "logs/");
  });
});
