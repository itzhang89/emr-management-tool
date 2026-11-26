import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { awsCredentialsService } from "@/services/awsCredentialsService";
import { useSessionStore } from "@/stores/sessionStore";
import type { AwsAccountSummary } from "@/types/domain";
import { useActiveAwsAccount, useSetActiveAwsAccount } from "./useAwsSettings";

vi.mock("@/services/awsCredentialsService", () => ({
  awsCredentialsService: {
    listAccounts: vi.fn(),
    setActiveAccount: vi.fn(),
    getAuthStatus: vi.fn(),
    refreshSession: vi.fn()
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

  it.each([
    { authMethod: "mfaSession", status: "needsMfa", code: "MfaCodeRequired" },
    { authMethod: "assumeRole", status: "needsMfa", code: "MfaCodeRequired" },
    { authMethod: "sso", status: "needsLogin", code: "SsoLoginRequired" }
  ] as const)("requires authentication before activating an expired $authMethod account", async ({ authMethod, status, code }) => {
    const account: AwsAccountSummary = {
      id: "acct-b", name: "B", region: "us-west-2", accessKeyIdMasked: "ASIA****", isActive: false, authMethod
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(["aws-accounts"], [account]);
    vi.mocked(awsCredentialsService.getAuthStatus).mockResolvedValue({
      accountId: account.id, authMethod, status, sessionExpiresAt: "2020-01-01T00:00:00.000Z"
    });
    const { result } = renderHook(() => useSetActiveAwsAccount(), { wrapper: wrapper(queryClient) });

    result.current.mutate(account.id);

    await waitFor(() => expect(result.current.error).toMatchObject({ code }));
    expect(awsCredentialsService.getAuthStatus).toHaveBeenCalledExactlyOnceWith(account.id);
    expect(awsCredentialsService.setActiveAccount).not.toHaveBeenCalled();
  });

  it("activates a near-expiry MFA account without requesting a fresh code", async () => {
    const account: AwsAccountSummary = {
      id: "acct-b", name: "B", region: "us-west-2", accessKeyIdMasked: "ASIA****", isActive: false,
      authMethod: "mfaSession"
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(["aws-accounts"], [account]);
    vi.mocked(awsCredentialsService.getAuthStatus).mockResolvedValue({
      accountId: account.id, authMethod: "mfaSession", status: "needsMfa",
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    vi.mocked(awsCredentialsService.setActiveAccount).mockResolvedValue({ ...account, isActive: true });
    const { result } = renderHook(() => useSetActiveAwsAccount(), { wrapper: wrapper(queryClient) });

    result.current.mutate(account.id);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(awsCredentialsService.refreshSession).not.toHaveBeenCalled();
  });

  it.each([false, true])("tries to renew an expired SSO session before activation (rejected token: %s)", async (tokenRejected) => {
    const account: AwsAccountSummary = {
      id: "acct-b", name: "B", region: "us-west-2", accessKeyIdMasked: "ASIA****", isActive: false, authMethod: "sso"
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(["aws-accounts"], [account]);
    vi.mocked(awsCredentialsService.getAuthStatus).mockResolvedValue({
      accountId: account.id, authMethod: "sso", status: "expired", sessionExpiresAt: "2020-01-01T00:00:00.000Z"
    });
    if (tokenRejected) {
      vi.mocked(awsCredentialsService.refreshSession).mockRejectedValue({
        service: "sso", code: "UnauthorizedException"
      });
    } else {
      vi.mocked(awsCredentialsService.refreshSession).mockResolvedValue({
        accountId: account.id,
        identity: { account: "123456789012", userId: "id", arn: "arn:aws:sts::123456789012:assumed-role/example/user" },
        sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString()
      });
    }
    vi.mocked(awsCredentialsService.setActiveAccount).mockResolvedValue({ ...account, isActive: true });
    const { result } = renderHook(() => useSetActiveAwsAccount(), { wrapper: wrapper(queryClient) });

    result.current.mutate(account.id);

    if (tokenRejected) {
      await waitFor(() => expect(result.current.error).toMatchObject({ code: "SsoLoginRequired" }));
      expect(awsCredentialsService.setActiveAccount).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(awsCredentialsService.refreshSession).toHaveBeenCalledBefore(vi.mocked(awsCredentialsService.setActiveAccount));
    }
    expect(awsCredentialsService.refreshSession).toHaveBeenCalledExactlyOnceWith(account.id);
  });
});
