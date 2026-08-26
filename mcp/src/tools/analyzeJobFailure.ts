import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { sanitizeLogText } from "../sanitize/index.js";
import { extractErrorSections } from "../analysis/index.js";

export const AnalyzeJobFailureArgs = z.object({
  jobId: z.string().min(1, "jobId is required"),
  virtualClusterId: z.string().optional(),
  accountId: z.string().optional(),
  logType: z.enum(["driver", "executor", "controller"]).optional().default("driver"),
  stream: z.string().optional().default("stderr"),
});

export type AnalyzeJobFailureArgs = z.infer<typeof AnalyzeJobFailureArgs>;

export function buildAnalyzeJobFailureTool(client: BridgeClient) {
  return async (args: AnalyzeJobFailureArgs) => {
    const { jobId } = args;

    let jobSummary: Awaited<ReturnType<BridgeClient["describeJob"]>> | null = null;
    try {
      jobSummary = await client.describeJob({
        accountId: args.accountId,
        jobId,
        virtualClusterId: args.virtualClusterId,
      });
    } catch {
      jobSummary = null;
    }

    // Resolve the virtual cluster id: prefer the caller's value, otherwise take
    // it from the describe result (the app can look a job up by id alone).
    const virtualClusterId = args.virtualClusterId || jobSummary?.virtualClusterId || "";

    // Fetch simplified log text
    let logText = "";
    let logSource: "s3" | "cloudwatch" | "none" = "none";

    // Try S3 first
    if (jobSummary?.describeDetails?.tags?.["emr.containers.job.logUri"]) {
      const logUri = jobSummary.describeDetails.tags["emr.containers.job.logUri"];
      try {
        const prefix = `${virtualClusterId}/jobs/${jobId}/`;
        const match = parseS3Uri(logUri);
        if (match) {
          const s3Objects = await client.listS3Objects({
            accountId: args.accountId,
            bucket: match.bucket,
            prefix: `${match.prefix}${prefix}`,
          });
          const targetStream = args.stream || "stderr";
          const matching = s3Objects.objects.filter((o) =>
            o.s3Key.toLowerCase().includes(targetStream.toLowerCase()),
          );
          const relevant = (matching.length > 0 ? matching : s3Objects.objects).slice(0, 3);

          const allMessages: string[] = [];
          for (const obj of relevant) {
            try {
              const content = await client.getS3Object({
                accountId: args.accountId,
                bucket: match.bucket,
                key: obj.s3Key,
              });
              allMessages.push(...content.content.split("\n").filter(Boolean));
            } catch {
              /* skip */
            }
          }
          if (allMessages.length > 0) {
            logText = allMessages.join("\n");
            logSource = "s3";
          }
        }
      } catch {
        /* fall through */
      }
    }

    // Fall back to CloudWatch
    if (!logText) {
      try {
        const logGroupName = `/aws/emr-containers/jobs/${jobId}`;
        const streamNamePrefix = `${virtualClusterId}/jobs/${jobId}/containers`;
        const result = await client.getLogs({
          accountId: args.accountId,
          jobId,
          logGroupName,
          streamNamePrefix,
          limit: 2000,
        });
        logText = result.entries.map((e) => e.message).join("\n");
        logSource = "cloudwatch";
      } catch {
        /* leave empty */
      }
    }

    const filtered = filterLogNoise(logText);
    const simplifiedText = filtered.text;
    const analysis = extractErrorSections(simplifiedText);

    const sanitizedTail = analysis.errorTail.map((l) => sanitizeLogText(l));
    const sanitizedCauses = analysis.candidateCauses.map((c) => ({
      ...c,
      evidence: sanitizeLogText(c.evidence),
    }));
    const sanitizedDeepest = analysis.deepestCausedBy
      ? sanitizeLogText(analysis.deepestCausedBy)
      : null;

    const report = {
      job: {
        id: jobId,
        name: jobSummary?.name || null,
        state: jobSummary?.state || null,
        stateDetails: jobSummary?.describeDetails?.stateDetails || null,
        created: jobSummary?.createdAt || null,
        finished: jobSummary?.finishedAt || null,
        releaseLabel: jobSummary?.describeDetails?.releaseLabel || null,
      },
      evidence: {
        errorTail: sanitizedTail,
        tracebacks: analysis.tracebacks.map((t) => sanitizeLogText(t)),
        deepestCausedBy: sanitizedDeepest,
        stepIds: analysis.stepIds,
        logSource,
      },
      candidateCauses: sanitizedCauses,
      meta: {
        totalLogLines: simplifiedText.split("\n").length,
        noiseFilteredLines: filtered.hiddenCount,
        analysisGenerated: new Date().toISOString(),
      },
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(report, null, 2),
        },
      ],
    };
  };
}

type S3UriMatch = { bucket: string; prefix: string } | null;

function parseS3Uri(uri: string): S3UriMatch {
  const m = uri.match(/^s3:\/\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return { bucket: m[1]!, prefix: m[2] || "" };
}

function filterLogNoise(text: string): { text: string; hiddenCount: number } {
  if (!text) return { text: "", hiddenCount: 0 };
  const lines = text.split("\n");
  const kept: string[] = [];
  let hiddenCount = 0;

  const SPARK_LINE_RE = /^(\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERROR|DEBUG|TRACE) ([^:]+): (.*)$/;
  const NOISE_LOGGERS = new Set([
    "TaskSetManager", "DAGScheduler", "BlockManagerInfo", "TaskSchedulerImpl",
    "MemoryStore", "CodeGenerator", "AppInfoParser", "Metrics", "SecurityManager",
    "ResourceUtils", "JettyUtils", "SparkEnv", "DiskBlockManager",
    "CoarseGrainedExecutorBackend", "ShuffleBlockFetcherIterator", "TorrentBroadcast",
    "FileScanRDD", "MapPartitionsRDD", "TransportClientFactory", "HiveConf",
    "SharedState", "SubResultCacheManager", "ContextCleaner", "SignalUtils",
    "NativeCodeLoader", "ShutdownHookManager", "CodecPool", "SchedulerExtensionServices",
  ]);

  function isNoiseLogger(logger: string): boolean {
    const base = logger.split("$")[0]!;
    return NOISE_LOGGERS.has(base);
  }

  for (const line of lines) {
    if (line.startsWith("SLF4J:")) { hiddenCount += 1; continue; }
    const match = SPARK_LINE_RE.exec(line);
    if (!match) { kept.push(line); continue; }
    const level = match[2]!;
    const logger = match[3]!;
    if (level === "INFO" && isNoiseLogger(logger)) { hiddenCount += 1; continue; }
    kept.push(line);
  }

  return { text: kept.join("\n"), hiddenCount };
}