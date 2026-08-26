import { describe, it, expect } from "vitest";
import type { BridgeClient, BridgeJobSummary } from "../src/bridge/client";
import { buildAnalyzeJobFailureTool } from "../src/tools/analyzeJobFailure";

function makeJob(
  overrides: Partial<BridgeJobSummary> &
    Pick<BridgeJobSummary, "id" | "state">,
): BridgeJobSummary {
  return {
    name: "my-job",
    accountId: "acct-1",
    region: "us-east-1",
    virtualClusterId: "vc-1",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function parse(result: { content: Array<{ type: "text"; text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

describe("buildAnalyzeJobFailureTool", () => {
  it("locates a job across accounts via findJobById when no virtualClusterId is given", async () => {
    const calls: string[] = [];
    const client = {
      findJobById: async (jobId: string) => {
        calls.push(`findJobById:${jobId}`);
        return {
          job: makeJob({ id: jobId, state: "FAILED" }),
          accountId: "acct-2",
          accountName: "My Second Account",
          region: "us-west-2",
          foundInOtherAccount: true,
        };
      },
      describeJob: async () => makeJob({ id: "x", state: "FAILED" }),
      getLogs: async () => ({ jobId: "x", entries: [], nextForwardToken: undefined }),
      listS3Objects: async () => ({ bucket: "b", objects: [], nextToken: undefined }),
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-00000abc" });

    expect(calls).toContain("findJobById:job-00000abc");
    const report = parse(result);
    expect(report.foundInOtherAccount).toBe(true);
    expect((report.job as { id: string }).id).toBe("job-00000abc");
    expect((report.account as { name: string }).name).toBe("My Second Account");
  });

  it("short-circuits with ok when the job COMPLETED (no log fetch)", async () => {
    let fetchedLogs = false;
    const client = {
      findJobById: async () => ({
        job: makeJob({
          id: "job-ok",
          state: "COMPLETED",
          finishedAt: "2026-08-01T10:30:00.000Z",
        }),
        accountId: "acct-1",
        region: "us-east-1",
        foundInOtherAccount: false,
      }),
      describeJob: async () => makeJob({ id: "x", state: "COMPLETED" }),
      getLogs: async () => {
        fetchedLogs = true;
        return { jobId: "job-ok", entries: [], nextForwardToken: undefined };
      },
      listS3Objects: async () => {
        fetchedLogs = true;
        return { bucket: "b", objects: [], nextToken: undefined };
      },
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-ok" });
    const report = parse(result);

    expect(report.ok).toBe(true);
    expect(fetchedLogs).toBe(false);
  });

  it("prefers S3 logs over CloudWatch for a failed job", async () => {
    const bucketsRead: string[] = [];
    const client = {
      findJobById: async () => ({
        job: makeJob({
          id: "job-s3",
          state: "FAILED",
          describeDetails: {
            configurationOverrides: {
              monitoringConfiguration: {
                s3MonitoringConfiguration: { logUri: "s3://my-log-bucket/path/" },
              },
            },
          },
        }),
        accountId: "acct-1",
        region: "us-east-1",
        foundInOtherAccount: false,
      }),
      describeJob: async () => makeJob({
        id: "job-s3",
        state: "FAILED",
        describeDetails: {
          configurationOverrides: {
            monitoringConfiguration: {
              s3MonitoringConfiguration: { logUri: "s3://my-log-bucket/path/" },
            },
          },
        },
      }),
      listS3Objects: async () => ({
        bucket: "my-log-bucket",
        objects: [
          { id: "1", label: "driver-stderr", stream: "stderr", s3Key: "path/vc-1/jobs/job-s3/driver-stderr", size: 10 },
          { id: "2", label: "driver-stdout", stream: "stdout", s3Key: "path/vc-1/jobs/job-s3/driver-stdout", size: 10 },
        ],
        nextToken: undefined,
      }),
      getS3Object: async ({ key }) => {
        bucketsRead.push(key);
        if (key.includes("stderr")) {
          return {
            bucket: "my-log-bucket",
            key,
            content: [
              "23/08/01 10:00:01 INFO TaskSetManager: Starting task",
              "23/08/01 10:00:02 ERROR SparkContext: Job aborted",
              "Caused by: java.lang.OutOfMemoryError: Java heap space",
            ].join("\n"),
          };
        }
        return { bucket: "my-log-bucket", key, content: "stdout line" };
      },
      getLogs: async () => {
        throw new Error("should not reach CloudWatch when S3 has logs");
      },
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-s3" });

    const report = parse(result) as {
      evidence: {
        logSource: string;
        deepestCausedBy: string | null;
        candidateCauses: Array<{ cause: string }>;
      };
    };
    expect(report.evidence.logSource).toBe("s3");
    expect(bucketsRead.some((k) => k.includes("stderr"))).toBe(true);
    expect(report.evidence.deepestCausedBy).toContain("OutOfMemoryError");
    expect(report.evidence.candidateCauses.some((c) => c.cause.includes("OOM"))).toBe(true);
  });

  it("falls back to CloudWatch when S3 yields nothing", async () => {
    const client = {
      findJobById: async () => ({
        job: makeJob({
          id: "job-cw",
          state: "FAILED",
          describeDetails: {
            configurationOverrides: {
              monitoringConfiguration: {
                s3MonitoringConfiguration: { logUri: "s3://my-log-bucket/path/" },
              },
            },
          },
        }),
        accountId: "acct-1",
        region: "us-east-1",
        foundInOtherAccount: false,
      }),
      describeJob: async () => makeJob({ id: "job-cw", state: "FAILED" }),
      listS3Objects: async () => ({ bucket: "my-log-bucket", objects: [], nextToken: undefined }),
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      getLogs: async () => ({
        jobId: "job-cw",
        entries: [
          { timestamp: "t", level: "error", message: "23/08/01 10:00:02 ERROR SparkContext: Job failed", streamName: "driver-stderr" },
        ],
        nextForwardToken: undefined,
      }),
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-cw" });

    const report = parse(result) as { evidence: { logSource: string } };
    expect(report.evidence.logSource).toBe("cloudwatch");
  });
});
