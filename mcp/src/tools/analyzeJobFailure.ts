import { z } from "zod";
import type { BridgeClient, BridgeJobSummary } from "../bridge/client.js";
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

/**
 * The single MCP tool.
 *
 * Flow:
 *  1. Locate the job. If a virtualClusterId is supplied, describe it directly
 *     (fast path within one account/cluster). Otherwise search across the
 *     configured accounts via the bridge (active account first, then others).
 *  2. If COMPLETED, short-circuit: the job ran normally — no log digging.
 *  3. Otherwise fetch the job's logs — S3 preferred, CloudWatch fallback — using
 *     the resolved account + virtual cluster.
 *  4. Filter noise, then extract only the error-relevant evidence and return a
 *     compact, sanitized report for the calling AI to judge.
 */
export function buildAnalyzeJobFailureTool(client: BridgeClient) {
  return async (args: AnalyzeJobFailureArgs) => {
    const { jobId } = args;

    // --- 1. Locate the job ---------------------------------------------------
    let job: BridgeJobSummary;
    let accountId: string | undefined = args.accountId;
    let accountName: string | undefined;
    let region: string | undefined;
    let foundInOtherAccount = false;

    if (args.virtualClusterId) {
      // Fast path: caller pinned the cluster. Describe within that scope.
      const summary = await client.describeJob({
        accountId,
        jobId,
        virtualClusterId: args.virtualClusterId,
      });
      job = summary;
      accountId = summary.accountId || accountId;
      accountName = summary.accountId || accountId;
      region = summary.region;
    } else {
      // Cross-account search: active account first, then the rest.
      const found = await client.findJobById(jobId);
      job = found.job;
      accountId = found.accountId;
      accountName = found.accountName;
      region = found.region;
      foundInOtherAccount = found.foundInOtherAccount;
    }

    const virtualClusterId = args.virtualClusterId || job.virtualClusterId;

    const describe = job.describeDetails;
    const failureReason = describe?.failureReason || null;
    const stateDetails = describe?.stateDetails || null;

    // --- 2. Normal completion short-circuit --------------------------------
    const state = (job.state || "").toUpperCase();
    if (state === "COMPLETED" || state === "SUCCEEDED") {
      return completionReport(job, { accountId, accountName, region, foundInOtherAccount });
    }

    // --- 3. Gather log evidence (S3 first, then CloudWatch) ----------------
    const evidence = await gatherLogEvidence(client, {
      accountId,
      jobId,
      virtualClusterId,
      logType: args.logType,
      stream: args.stream,
    });

    // --- 4. Extract only the error-relevant lines ---------------------------
    const filtered = filterLogNoise(evidence.logText);
    const analysis = extractErrorSections(filtered.text);
    const candidateCauses = analysis.candidateCauses.map((c) => ({
      ...c,
      evidence: sanitizeLogText(c.evidence),
    }));

    const report = {
      foundInOtherAccount,
      account: {
        id: accountId,
        name: accountName || null,
        region,
      },
      job: {
        id: job.id,
        name: job.name || null,
        state: job.state || null,
        failureReason: sanitizeLogText(failureReason || ""),
        stateDetails: sanitizeLogText(stateDetails || ""),
        virtualClusterId,
        createdAt: job.createdAt || null,
        finishedAt: job.finishedAt || null,
        releaseLabel: describe?.releaseLabel || null,
      },
      summary: summarizeFailure(
        state,
        failureReason,
        stateDetails,
        candidateCauses,
        evidence.source,
      ),
      evidence: {
        logSource: evidence.source,
        errorTail: analysis.errorTail.map((l) => sanitizeLogText(l)),
        tracebacks: analysis.tracebacks.map((t) => sanitizeLogText(t)),
        deepestCausedBy: analysis.deepestCausedBy
          ? sanitizeLogText(analysis.deepestCausedBy)
          : null,
        stepIds: analysis.stepIds,
        candidateCauses,
      },
      meta: {
        totalLogLines: filtered.text.split("\n").length,
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

// A job that finished successfully: no logs are fetched, just a clean status.
function completionReport(
  job: BridgeJobSummary,
  scope: {
    accountId?: string;
    accountName?: string;
    region?: string;
    foundInOtherAccount: boolean;
  },
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: true,
            foundInOtherAccount: scope.foundInOtherAccount,
            account: {
              id: scope.accountId,
              name: scope.accountName || null,
              region: scope.region,
            },
            summary: "Job completed successfully — no failure to analyze.",
            job: {
              id: job.id,
              name: job.name || null,
              state: job.state || null,
              virtualClusterId: job.virtualClusterId,
              releasedLabel: job.describeDetails?.releaseLabel || null,
              startedAt: job.startedAt || null,
              finishedAt: job.finishedAt || null,
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}

function summarizeFailure(
  state: string,
  failureReason: string | null,
  stateDetails: string | null,
  candidateCauses: Array<{ cause: string; confidence: string }>,
  source: "s3" | "cloudwatch" | "none",
): string {
  const parts: string[] = [];
  if (failureReason) {
    parts.push(`EMR failure reason: ${failureReason}`);
  }
  if (stateDetails) {
    parts.push(`State details: ${stateDetails}`);
  }
  if (candidateCauses.length > 0) {
    parts.push(
      `Heuristic causes: ${candidateCauses
        .map((c) => `${c.cause} (${c.confidence})`)
        .join("; ")}`,
    );
  }
  if (source === "none") {
    parts.push("No log source was found (neither S3 nor CloudWatch).");
  }
  return parts.length > 0
    ? parts.join("\n")
    : `Job is in state ${state} with no additional detail available.`;
}

interface LogEvidence {
  logText: string;
  source: "s3" | "cloudwatch" | "none";
}

/**
 * Fetch the job's logs, S3 preferred then CloudWatch. Destination resolution
 * mirrors the desktop app's `jobLogDestinations.ts`:
 *
 *  - S3       → configurationOverrides.monitoringConfiguration.s3MonitoringConfiguration.logUri
 *  - CloudWatch → configurationOverrides.monitoringConfiguration.cloudWatchMonitoringConfiguration
 *                 (logGroupName + streamNamePrefix), falling back to the
 *                 conventional `/aws/emr-containers/jobs/{jobId}` group.
 */
async function gatherLogEvidence(
  client: BridgeClient,
  params: {
    accountId?: string;
    jobId: string;
    virtualClusterId?: string;
    logType?: string;
    stream?: string;
  },
): Promise<LogEvidence> {
  const { accountId, jobId, virtualClusterId, logType, stream } = params;
  const desiredStream = stream || "stderr";

  // Describe the job once to learn its monitoring configuration.
  let describe: BridgeJobSummary | undefined;
  try {
    describe = await client.describeJob({ accountId, jobId, virtualClusterId });
  } catch {
    /* rely on CloudWatch defaults below */
  }

  const monitoring = describe?.describeDetails?.configurationOverrides?.monitoringConfiguration;

  // --- Try S3 first --------------------------------------------------------
  const s3Uri =
    monitoring?.s3MonitoringConfiguration?.logUri ||
    describe?.describeDetails?.tags?.["emr.containers.job.logUri"];

  if (s3Uri && virtualClusterId) {
    const match = parseS3Uri(s3Uri);
    if (match) {
      try {
        const prefix = `${virtualClusterId}/jobs/${jobId}/`;
        const listing = await client.listS3Objects({
          accountId,
          bucket: match.bucket,
          prefix: `${match.prefix}${prefix}`,
        });

        const matching = listing.objects.filter((o) =>
          o.s3Key.toLowerCase().includes(desiredStream.toLowerCase()),
        );
        const relevant = (matching.length > 0 ? matching : listing.objects).slice(0, 5);

        const messages: string[] = [];
        for (const obj of relevant) {
          try {
            const content = await client.getS3Object({
              accountId,
              bucket: match.bucket,
              key: obj.s3Key,
            });
            messages.push(...content.content.split("\n").filter(Boolean));
          } catch {
            /* skip unreadable object */
          }
        }
        if (messages.length > 0) {
          return { logText: messages.join("\n"), source: "s3" };
        }
      } catch {
        /* fall through to CloudWatch */
      }
    }
  }

  // --- Fall back to CloudWatch --------------------------------------------
  if (virtualClusterId) {
    try {
      // Use the job's configured group/prefix when present, else the convention.
      const cw = monitoring?.cloudWatchMonitoringConfiguration;
      const logGroupName =
        cw?.logGroupName?.trim() || `/aws/emr-containers/jobs/${jobId}`;

      let streamNamePrefix = `${virtualClusterId}/jobs/${jobId}/containers`;
      if (cw?.logStreamNamePrefix?.trim()) {
        const base = cw.logStreamNamePrefix.trim();
        const normalized = base.endsWith("/") ? base : `${base}/`;
        streamNamePrefix = `${normalized}${virtualClusterId}/jobs/${jobId}/`;
      }

      const result = await client.getLogs({
        accountId,
        jobId,
        logGroupName,
        streamNamePrefix,
        limit: 5000,
      });

      let entries = result.entries;
      const want = (logType || "driver").toLowerCase();
      if (want === "driver") {
        entries = entries.filter((e) => e.streamName.toLowerCase().includes("driver"));
      } else if (want === "executor") {
        entries = entries.filter((e) => e.streamName.toLowerCase().includes("exec"));
      } else if (want === "controller") {
        entries = entries.filter(
          (e) =>
            !e.streamName.toLowerCase().includes("driver") &&
            !e.streamName.toLowerCase().includes("exec"),
        );
      }
      if (stream) {
        const streamFiltered = entries.filter((e) =>
          e.streamName.toLowerCase().includes(stream!.toLowerCase()),
        );
        if (streamFiltered.length > 0) entries = streamFiltered;
      }

      if (entries.length > 0) {
        return { logText: entries.map((e) => e.message).join("\n"), source: "cloudwatch" };
      }
    } catch {
      /* leave logText empty */
    }
  }

  return { logText: "", source: "none" };
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

  const NOISE_PREFIXES = ["MapOutputTracker", "ResourceProfile", "BlockManager", "YarnScheduler"];

  function isNoiseLogger(logger: string): boolean {
    const base = logger.split("$")[0]!;
    if (NOISE_LOGGERS.has(base)) return true;
    return NOISE_PREFIXES.some((p) => base.startsWith(p));
  }

  for (const line of lines) {
    if (line.startsWith("SLF4J:")) { hiddenCount += 1; continue; }

    const match = SPARK_LINE_RE.exec(line);
    if (!match) { kept.push(line); continue; }

    const level = match[2]!;
    const logger = match[3]!;
    const message = match[4] ?? "";

    if (level === "INFO" && (isNoiseLogger(logger) || isRoutineInfo(logger, message))) {
      hiddenCount += 1;
      continue;
    }

    kept.push(line);
  }

  return { text: kept.join("\n"), hiddenCount };
}

// Routine per-task INFO chatter that adds nothing for root-cause analysis.
function isRoutineInfo(logger: string, message: string): boolean {
  if (logger === "Executor" && (message.startsWith("Running task") || message.startsWith("Finished task"))) {
    return true;
  }
  if (
    logger === "SparkContext" &&
    !["Running Spark version", "Submitted application"].some((k) => message.includes(k))
  ) {
    return true;
  }
  if (logger === "TaskSetManager" && /Finished task/.test(message)) return true;
  if (logger === "blockManager.BlockManagerStore" || message.startsWith("asked to send block")) return true;
  return false;
}
