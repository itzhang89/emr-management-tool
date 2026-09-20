import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJobLogs, useJobLogStreams, useS3JobLogObject, useS3JobLogObjects } from "./useLogs";

let activeAccountId = "acct-a";

vi.mock("@/hooks/useAwsSettings", () => ({
  useActiveAwsAccount: () => ({ data: { id: activeAccountId, name: "Test", region: "us-east-1" } })
}));

vi.mock("@/services/cloudWatchLogsService", () => ({
  cloudWatchLogsService: {
    getJobLogs: vi.fn(async () => ({ entries: [], nextForwardToken: undefined })),
    listJobLogStreams: vi.fn(async () => ({ streams: [] }))
  }
}));

vi.mock("@/services/s3Service", () => ({
  s3Service: {
    listJobLogObjects: vi.fn(async () => ({ objects: [] })),
    getJobLogObject: vi.fn(async () => ({ content: "" }))
  }
}));

function renderLogHooks(accountId: string) {
  activeAccountId = accountId;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderHook(
    () => {
      useJobLogStreams({ jobId: "job-1", logGroupName: "group", streamNamePrefix: "prefix" });
      useJobLogs({
        jobId: "job-1",
        logGroupName: "group",
        streamNamePrefix: "prefix",
        logStreamName: "stream"
      });
      useS3JobLogObjects({ bucket: "bucket", prefix: "prefix" });
      useS3JobLogObject("bucket", "key");
    },
    {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
  );
  return queryClient.getQueryCache().getAll().map((query) => query.queryKey as unknown[]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("log query keys", () => {
  it("carries the account on every key, so two accounts never share log data", () => {
    const keys = renderLogHooks("acct-a");

    expect(keys).toHaveLength(4);
    // Job run ids are only unique within an account: a key without it would
    // serve account A's log text for account B's identically named job.
    for (const key of keys) {
      expect(key[1]).toBe("acct-a");
    }
  });

  it("gives the second account its own entries", () => {
    const first = renderLogHooks("acct-a").map((key) => JSON.stringify(key));
    const second = renderLogHooks("acct-b").map((key) => JSON.stringify(key));

    expect(second.some((key) => first.includes(key))).toBe(false);
  });
});
