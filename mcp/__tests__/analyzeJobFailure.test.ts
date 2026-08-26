import { describe, it, expect } from "vitest";
import type { BridgeClient, BridgeJobSummary } from "../src/bridge/client";
import { buildAnalyzeJobFailureTool } from "../src/tools/analyzeJobFailure";
import {
  buildJobS3LogPrefix,
  defaultCloudWatchDestination,
  parseS3Uri,
  resolveJobLogDestinations,
} from "../src/tools/jobLogDestinations";

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

  it("normalizes a spark- prefixed id before searching (exact match otherwise)", async () => {
    const calls: string[] = [];
    const client = {
      findJobById: async (jobId: string) => {
        calls.push(jobId);
        return {
          job: makeJob({ id: jobId, state: "COMPLETED" }),
          accountId: "acct-1",
          region: "us-east-1",
          foundInOtherAccount: false,
        };
      },
      describeJob: async () => makeJob({ id: "x", state: "COMPLETED" }),
      getLogs: async () => ({ jobId: "x", entries: [], nextForwardToken: undefined }),
      listS3Objects: async () => ({ bucket: "b", objects: [], nextToken: undefined }),
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    await tool({ jobId: "  spark-job-00000abc  " });

    expect(calls).toEqual(["job-00000abc"]);
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

  it("prefers S3 logs over CloudWatch, with the exact UI prefix (no leading slash)", async () => {
    const listCalls: Array<{ bucket: string; prefix: string }> = [];
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
      listS3Objects: async (req: { bucket: string; prefix: string }) => {
        listCalls.push({ bucket: req.bucket, prefix: req.prefix });
        return {
          bucket: "my-log-bucket",
          objects: [
            { id: "1", label: "driver-stderr", stream: "stderr", s3Key: "path/vc-1/jobs/job-s3/driver-stderr", size: 10 },
            { id: "2", label: "driver-stdout", stream: "stdout", s3Key: "path/vc-1/jobs/job-s3/driver-stdout", size: 10 },
          ],
          nextToken: undefined,
        };
      },
      getS3Object: async ({ key }: { key: string }) => {
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

    // Same prefix the desktop Logs page builds (parseS3Uri normalizes the
    // slash; no leading "/" that would match no real S3 key).
    expect(listCalls).toEqual([
      { bucket: "my-log-bucket", prefix: "path/vc-1/jobs/job-s3/" },
    ]);

    const report = parse(result) as {
      evidence: {
        logSource: string;
        deepestCausedBy: string | null;
        candidateCauses: Array<{ cause: string }>;
        rawLogs: string;
      };
    };
    expect(report.evidence.logSource).toBe("s3");
    expect(bucketsRead.some((k) => k.includes("stderr"))).toBe(true);
    expect(report.evidence.deepestCausedBy).toContain("OutOfMemoryError");
    expect(report.evidence.candidateCauses.some((c) => c.cause.includes("OOM"))).toBe(true);
    // The actual (noise-filtered) log text is returned too, so the caller can
    // always judge — even beyond the heuristic fields.
    expect(report.evidence.rawLogs).toContain("ERROR SparkContext: Job aborted");
    expect(report.evidence.rawLogs).toContain("Caused by: java.lang.OutOfMemoryError: Java heap space");
    expect(report.evidence.rawLogs).not.toContain("INFO ApplicationMaster"); // routine INFO noise filtered out of raw evidence
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

  it("uses the conventional CloudWatch group with the job id stream prefix when there is no monitoring config", async () => {
    const logCalls: Array<{ logGroupName?: string; streamNamePrefix?: string }> = [];
    const client = {
      findJobById: async () => ({
        job: makeJob({ id: "job-plain", state: "FAILED" }),
        accountId: "acct-1",
        region: "us-east-1",
        foundInOtherAccount: false,
      }),
      describeJob: async () => makeJob({ id: "job-plain", state: "FAILED" }),
      listS3Objects: async () => ({ bucket: "b", objects: [], nextToken: undefined }),
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      getLogs: async (req: { logGroupName?: string; streamNamePrefix?: string }) => {
        logCalls.push({
          logGroupName: req.logGroupName,
          streamNamePrefix: req.streamNamePrefix,
        });
        return {
          jobId: "job-plain",
          entries: [
            { timestamp: "t", level: "error", message: "23/08/01 ERROR SparkContext: failed", streamName: "driver-stderr" },
          ],
          nextForwardToken: undefined,
        };
      },
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-plain" });

    expect(logCalls).toEqual([
      { logGroupName: "/aws/emr-containers/jobs/job-plain", streamNamePrefix: "job-plain" },
    ]);
    const report = parse(result) as { evidence: { logSource: string } };
    expect(report.evidence.logSource).toBe("cloudwatch");
  });

  it("probes the conventional CloudWatch group as a last resort for S3-only jobs with an empty archive", async () => {
    const logCalls: Array<{ logGroupName?: string; streamNamePrefix?: string }> = [];
    const client = {
      findJobById: async () => ({
        job: makeJob({
          id: "job-s3only",
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
        id: "job-s3only",
        state: "FAILED",
        describeDetails: {
          configurationOverrides: {
            monitoringConfiguration: {
              s3MonitoringConfiguration: { logUri: "s3://my-log-bucket/path/" },
            },
          },
        },
      }),
      listS3Objects: async () => ({ bucket: "my-log-bucket", objects: [], nextToken: undefined }),
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      getLogs: async (req: { logGroupName?: string; streamNamePrefix?: string }) => {
        logCalls.push({
          logGroupName: req.logGroupName,
          streamNamePrefix: req.streamNamePrefix,
        });
        return {
          jobId: "job-s3only",
          entries: [
            { timestamp: "t", level: "error", message: "23/08/01 ERROR SparkContext: failed", streamName: "driver-stderr" },
          ],
          nextForwardToken: undefined,
        };
      },
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-s3only" });

    expect(logCalls).toEqual([
      { logGroupName: "/aws/emr-containers/jobs/job-s3only", streamNamePrefix: "job-s3only" },
    ]);
    const report = parse(result) as { evidence: { logSource: string } };
    expect(report.evidence.logSource).toBe("cloudwatch");
  });

  it("returns raw logs and guidance when the evidence extractor finds nothing", async () => {
    const plainLogs = [
      "application output line one",
      "23/08/01 10:00:05 INFO ApplicationMaster: preparing to shut down",
      "some unstructured shutdown notice without any exception markers",
    ].join("\n");
    const client = {
      findJobById: async () => ({
        job: makeJob({
          id: "job-noev",
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
        id: "job-noev",
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
          { id: "1", label: "driver-stderr", stream: "stderr", s3Key: "path/vc-1/jobs/job-noev/driver-stderr", size: 10 },
        ],
        nextToken: undefined,
      }),
      getS3Object: async ({ key }: { key: string }) => ({
        bucket: "my-log-bucket",
        key,
        content: plainLogs,
      }),
      getLogs: async () => {
        throw new Error("should not reach CloudWatch when S3 has logs");
      },
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-noev" });

    const report = parse(result) as {
      summary: string;
      evidence: {
        logSource: string;
        errorTail: string[];
        tracebacks: string[];
        deepestCausedBy: string | null;
        candidateCauses: unknown[];
        rawLogs: string;
        truncated: boolean;
      };
    };
    // Heuristics found nothing...
    expect(report.evidence.errorTail).toEqual([]);
    expect(report.evidence.tracebacks).toEqual([]);
    expect(report.evidence.deepestCausedBy).toBeNull();
    expect(report.evidence.candidateCauses).toEqual([]);
    // ...but the caller still gets the (noise-filtered, sanitized) logs.
    expect(report.evidence.logSource).toBe("s3");
    expect(report.evidence.rawLogs).toContain("application output line one");
    expect(report.evidence.rawLogs).toContain("unstructured shutdown notice");
    expect(report.evidence.rawLogs).not.toContain("INFO ApplicationMaster"); // routine noise filtered
    expect(report.evidence.truncated).toBe(false);
    expect(report.summary).toContain("rawLogs");
  });

  // --- Controller (pod-level) evidence -------------------------------------

  it("collects control-logs as controller evidence alongside the driver logs", async () => {
    const readKeys: string[] = [];
    const controlLogs = [
      "2026-08-01T10:00:00Z Failed to pull image \"my-registry/spark:1.0\": ErrImagePull",
      "2026-08-01T10:00:05Z ERROR pod spark-job-ctl-driver failed to start",
    ].join("\n");
    const driverLogs = [
      "23/08/01 10:00:01 INFO TaskSetManager: Starting task",
      "23/08/01 10:00:02 ERROR SparkContext: Job aborted",
    ].join("\n");

    const client = {
      findJobById: async () => ({
        job: makeJob({
          id: "job-ctl",
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
        id: "job-ctl",
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
          {
            id: "1",
            label: "job-ctl-qs8tm stderr",
            type: "controller",
            container: "control-logs",
            pod: "job-ctl-qs8tm",
            stream: "stderr",
            s3Key: "path/vc-1/jobs/job-ctl/control-logs/job-ctl-qs8tm/stderr.gz",
            size: 10,
          },
          {
            id: "2",
            label: "spark-job-ctl-driver stderr",
            type: "driver",
            container: "spark-job-ctl",
            pod: "spark-job-ctl-driver",
            stream: "stderr",
            s3Key: "path/vc-1/jobs/job-ctl/containers/spark-job-ctl/spark-job-ctl-driver/stderr.gz",
            size: 10,
          },
        ],
        nextToken: undefined,
      }),
      getS3Object: async ({ key }: { key: string }) => {
        readKeys.push(key);
        return {
          bucket: "my-log-bucket",
          key,
          content: key.includes("control-logs") ? controlLogs : driverLogs,
        };
      },
      getLogs: async () => {
        throw new Error("should not reach CloudWatch when S3 has logs");
      },
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-ctl" });

    // Both tiers are read from the single listing.
    expect(readKeys.some((k) => k.includes("/control-logs/"))).toBe(true);
    expect(readKeys.some((k) => k.includes("/containers/"))).toBe(true);

    const report = parse(result) as {
      summary: string;
      controllerEvidence: { logSource: string; errorTail: string[]; rawLogs: string };
      evidence: { logSource: string; rawLogs: string };
    };
    // Controller evidence is reported separately and is not mixed into the
    // application logs.
    expect(report.controllerEvidence.logSource).toBe("s3");
    expect(report.controllerEvidence.rawLogs).toContain("ErrImagePull");
    expect(report.controllerEvidence.errorTail.some((l) => l.includes("failed to start"))).toBe(true);
    expect(report.evidence.rawLogs).toContain("ERROR SparkContext: Job aborted");
    expect(report.evidence.rawLogs).not.toContain("ErrImagePull");
  });

  it("reports controller causes ahead of application causes in the summary", async () => {
    const client = {
      findJobById: async () => ({
        job: makeJob({
          id: "job-oomkill",
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
      describeJob: async () => makeJob({ id: "job-oomkill", state: "FAILED" }),
      listS3Objects: async () => ({
        bucket: "my-log-bucket",
        objects: [
          {
            id: "1",
            type: "controller",
            stream: "stderr",
            s3Key: "path/vc-1/jobs/job-oomkill/control-logs/job-oomkill-ab12c/stderr.gz",
            size: 10,
            label: "ctl",
            container: "control-logs",
            pod: "job-oomkill-ab12c",
          },
        ],
        nextToken: undefined,
      }),
      getS3Object: async ({ key }: { key: string }) => ({
        bucket: "my-log-bucket",
        key,
        content: "2026-08-01T10:00:00Z ERROR container OOMKilled: exceeded memory limit",
      }),
      getLogs: async () => ({ jobId: "job-oomkill", entries: [], nextForwardToken: undefined }),
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-oomkill" });

    const report = parse(result) as {
      summary: string;
      controllerEvidence: { candidateCauses: Array<{ cause: string }> };
      evidence: { logSource: string };
    };
    expect(report.controllerEvidence.candidateCauses.some((c) => c.cause.includes("OOM"))).toBe(true);
    expect(report.summary).toContain("Controller (pod-level) causes");
    // No application logs existed, but the pod-level cause still surfaced.
    expect(report.evidence.logSource).toBe("none");
  });

  it("splits CloudWatch streams into controller and application tiers in one fetch", async () => {
    let getLogsCalls = 0;
    const client = {
      findJobById: async () => ({
        job: makeJob({ id: "job-cwsplit", state: "FAILED" }),
        accountId: "acct-1",
        region: "us-east-1",
        foundInOtherAccount: false,
      }),
      describeJob: async () => makeJob({ id: "job-cwsplit", state: "FAILED" }),
      listS3Objects: async () => ({ bucket: "b", objects: [], nextToken: undefined }),
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      getLogs: async () => {
        getLogsCalls += 1;
        return {
          jobId: "job-cwsplit",
          entries: [
            {
              timestamp: "t",
              level: "error",
              message: "ERROR pod job-cwsplit-ab12c: ErrImagePull",
              streamName: "job-cwsplit-ab12c/stderr",
            },
            {
              timestamp: "t",
              level: "error",
              message: "23/08/01 ERROR SparkContext: Job aborted",
              streamName: "spark-job-cwsplit-driver/stderr",
            },
          ],
          nextForwardToken: undefined,
        };
      },
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    const result = await tool({ jobId: "job-cwsplit" });

    // One CloudWatch fetch serves both tiers — no duplicate AWS calls.
    expect(getLogsCalls).toBe(1);

    const report = parse(result) as {
      controllerEvidence: { logSource: string; rawLogs: string };
      evidence: { logSource: string; rawLogs: string };
    };
    expect(report.controllerEvidence.logSource).toBe("cloudwatch");
    expect(report.controllerEvidence.rawLogs).toContain("ErrImagePull");
    expect(report.evidence.logSource).toBe("cloudwatch");
    expect(report.evidence.rawLogs).toContain("ERROR SparkContext: Job aborted");
    expect(report.evidence.rawLogs).not.toContain("ErrImagePull");
  });

  // --- Job id validation ---------------------------------------------------

  it("rejects a malformed job id without searching for it", async () => {
    let searched = false;
    const client = {
      findJobById: async () => {
        searched = true;
        throw new Error("must not search for a malformed id");
      },
      describeJob: async () => {
        searched = true;
        throw new Error("must not describe a malformed id");
      },
      listS3Objects: async () => {
        searched = true;
        return { bucket: "b", objects: [], nextToken: undefined };
      },
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      getLogs: async () => {
        searched = true;
        return { jobId: "x", entries: [], nextForwardToken: undefined };
      },
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    // A truncated id — the common failure mode when a model copies it along.
    const result = await tool({ jobId: "0000000381pbkl" });

    expect(searched).toBe(false);
    const report = parse(result) as {
      ok: boolean;
      error: string;
      providedJobId: string;
      summary: string;
      nextStep: string;
    };
    expect(report.ok).toBe(false);
    expect(report.error).toBe("invalidJobId");
    expect(report.providedJobId).toBe("0000000381pbkl");
    expect(report.summary).toContain("truncated");
    expect(report.nextStep).toContain("Ask the user");
  });

  it("rejects ids that are clearly not EMR job ids", async () => {
    const client = {
      findJobById: async () => {
        throw new Error("must not search");
      },
      describeJob: async () => {
        throw new Error("must not describe");
      },
      listS3Objects: async () => ({ bucket: "b", objects: [], nextToken: undefined }),
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      getLogs: async () => ({ jobId: "x", entries: [], nextForwardToken: undefined }),
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;
    const tool = buildAnalyzeJobFailureTool(client);

    for (const bad of ["my failed job", "the job from yesterday", "0000000381T77O3G8F5x"]) {
      const report = parse(await tool({ jobId: bad })) as { error: string };
      expect(report.error).toBe("invalidJobId");
    }
  });

  it("accepts a well-formed id, with or without the spark- prefix", async () => {
    const searchedIds: string[] = [];
    const client = {
      findJobById: async (jobId: string) => {
        searchedIds.push(jobId);
        return {
          job: makeJob({ id: jobId, state: "COMPLETED" }),
          accountId: "acct-1",
          region: "us-east-1",
          foundInOtherAccount: false,
        };
      },
      describeJob: async () => makeJob({ id: "x", state: "COMPLETED" }),
      listS3Objects: async () => ({ bucket: "b", objects: [], nextToken: undefined }),
      getS3Object: async () => ({ bucket: "b", key: "k", content: "" }),
      getLogs: async () => ({ jobId: "x", entries: [], nextForwardToken: undefined }),
      listAccounts: async () => [],
      listLogStreams: async () => ({ jobId: "x", streams: [], nextToken: undefined }),
    } as unknown as BridgeClient;

    const tool = buildAnalyzeJobFailureTool(client);
    await tool({ jobId: "0000000381t77o3g8f5" });
    await tool({ jobId: "spark-0000000381t77o3g8f5" });
    await tool({ jobId: "job-abc-123" });

    expect(searchedIds).toEqual([
      "0000000381t77o3g8f5",
      "0000000381t77o3g8f5",
      "job-abc-123",
    ]);
  });
});

// The MCP port of src/services/jobLogDestinations.ts must stay in sync with
// the desktop app's tests (src/services/jobLogDestinations.test.ts).
describe("jobLogDestinations (MCP mirror)", () => {
  it("parses s3 uris with and without key prefixes", () => {
    expect(parseS3Uri("s3://logs-bucket/emr/")).toEqual({ bucket: "logs-bucket", prefix: "emr/" });
    expect(parseS3Uri("s3://logs-bucket")).toEqual({ bucket: "logs-bucket", prefix: "" });
  });

  it("builds the EMR on EKS job log prefix under the configured log uri", () => {
    expect(buildJobS3LogPrefix("s3://logs-bucket/emr/", "vc-1", "job-running")).toEqual({
      bucket: "logs-bucket",
      prefix: "emr/vc-1/jobs/job-running/",
    });
  });

  it("resolves cloudwatch and s3 destinations from describe monitoring configuration", () => {
    const destinations = resolveJobLogDestinations({
      id: "job-running",
      virtualClusterId: "vc-1",
      describeDetails: {
        configurationOverrides: {
          monitoringConfiguration: {
            cloudWatchMonitoringConfiguration: {
              logGroupName: "/aws/emr-containers/jobs/custom",
              logStreamNamePrefix: "custom-prefix",
            },
            s3MonitoringConfiguration: { logUri: "s3://logs-bucket/emr/" },
          },
        },
      },
    });

    expect(destinations).toEqual({
      cloudWatch: {
        logGroupName: "/aws/emr-containers/jobs/custom",
        streamNamePrefix: "custom-prefix/vc-1/jobs/job-running/",
      },
      s3: { bucket: "logs-bucket", prefix: "emr/vc-1/jobs/job-running/" },
    });
  });

  it("returns only the configured destination when monitoring is partial", () => {
    const cloudWatchOnly = resolveJobLogDestinations({
      id: "job-running",
      virtualClusterId: "vc-1",
      describeDetails: {
        configurationOverrides: {
          monitoringConfiguration: {
            cloudWatchMonitoringConfiguration: { logGroupName: "/aws/emr-containers/jobs/custom" },
          },
        },
      },
    });
    const s3Only = resolveJobLogDestinations({
      id: "job-running",
      virtualClusterId: "vc-1",
      describeDetails: {
        configurationOverrides: {
          monitoringConfiguration: {
            s3MonitoringConfiguration: { logUri: "s3://logs-bucket" },
          },
        },
      },
    });

    expect(cloudWatchOnly).toEqual({
      cloudWatch: {
        logGroupName: "/aws/emr-containers/jobs/custom",
        streamNamePrefix: "vc-1/jobs/job-running/",
      },
    });
    expect(s3Only).toEqual({
      s3: { bucket: "logs-bucket", prefix: "vc-1/jobs/job-running/" },
    });
  });

  it("falls back to the default cloudwatch group naming convention", () => {
    expect(defaultCloudWatchDestination({ id: "job-running" })).toEqual({
      logGroupName: "/aws/emr-containers/jobs/job-running",
      streamNamePrefix: "job-running",
    });
  });
});
