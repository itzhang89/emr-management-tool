import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { awsCredentialsService } from "@/services/awsCredentialsService";
import { useSessionStore } from "@/stores/sessionStore";
import { useActiveAwsAccount, useSetActiveAwsAccount } from "./useAwsSettings";

vi.mock("@/services/awsCredentialsService", () => ({
  awsCredentialsService: {
    listAccounts: vi.fn(),
    setActiveAccount: vi.fn()
  }
}));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAwsSettings account scoping helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useSessionStore.getState().resetAccountScopedSession();
  });

  it("returns the active AWS account summary", async () => {
    vi.mocked(awsCredentialsService.listAccounts).mockResolvedValue([
      {
        id: "acct-a",
        name: "A",
        region: "us-east-1",
        accessKeyIdMasked: "AKIA****",
        isActive: false
      },
      {
        id: "acct-b",
        name: "B",
        region: "us-west-2",
        accessKeyIdMasked: "AKIB****",
        isActive: true
      }
    ]);
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useActiveAwsAccount(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.data?.id).toBe("acct-b"));
  });

  it("resets account-scoped session selections after activating another account", async () => {
    vi.mocked(awsCredentialsService.setActiveAccount).mockResolvedValue({
      id: "acct-b",
      name: "B",
      region: "us-west-2",
      accessKeyIdMasked: "AKIB****",
      isActive: true
    });
    useSessionStore.setState({
      selectedVirtualClusterId: "vc-a",
      selectedJobId: "job-a",
      selectedJobVirtualClusterId: "vc-a",
      selectedS3Bucket: "bucket-a",
      selectedS3Prefix: "prefix-a/"
    });
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useSetActiveAwsAccount(), { wrapper: wrapper(queryClient) });
    result.current.mutate("acct-b");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useSessionStore.getState().selectedVirtualClusterId).toBeUndefined();
    expect(useSessionStore.getState().selectedJobId).toBeUndefined();
    expect(useSessionStore.getState().selectedS3Bucket).toBeUndefined();
  });

  it("updates the cached active account immediately after activating another account", async () => {
    vi.mocked(awsCredentialsService.listAccounts).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(awsCredentialsService.setActiveAccount).mockResolvedValue({
      id: "acct-b",
      name: "B",
      region: "us-west-2",
      accessKeyIdMasked: "AKIB****",
      isActive: true
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(["aws-accounts"], [
      {
        id: "acct-a",
        name: "A",
        region: "us-east-1",
        accessKeyIdMasked: "AKIA****",
        isActive: true
      },
      {
        id: "acct-b",
        name: "B",
        region: "us-west-2",
        accessKeyIdMasked: "AKIB****",
        isActive: false
      }
    ]);

    const { result } = renderHook(
      () => ({
        active: useActiveAwsAccount(),
        setActive: useSetActiveAwsAccount()
      }),
      { wrapper: wrapper(queryClient) }
    );

    expect(result.current.active.data?.id).toBe("acct-a");
    result.current.setActive.mutate("acct-b");

    await waitFor(() => expect(result.current.setActive.isSuccess).toBe(true));
    expect(result.current.active.data?.id).toBe("acct-b");
  });
});
