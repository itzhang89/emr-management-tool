import { z } from "zod";
import type { BridgeClient, BridgeFindJobResult, BridgeJobSummary } from "../bridge/client.js";
import { sanitizeLogText } from "../sanitize/index.js";
import { extractErrorSections } from "../analysis/index.js";
import {
  defaultCloudWatchDestination,
  resolveJobLogDestinations,
  type CloudWatchLogDestination,
  type S3LogDestination,
} from "./jobLogDestinations.js";

export const AnalyzeJobFailureArgs = z.object({
  jobId: z.string().min(1, "jobId is required"),
  virtualClusterId: z.string().optional(),
  accountId: z.string().optional(),
  logType: z.enum(["driver", "executor", "controller"]).optional().default("driver"),
  stream: z.string().optional().default("stderr"),
});

export type AnalyzeJobFailureArgs = z.infer<typeof AnalyzeJobFailureArgs>;

// Mirrors the desktop app's `src/services/emrJobId.ts`: "spark-<id>" and a raw
// "<id>" are the same job. Only the canonical form is removed; ids are still
// matched exactly everywhere (no prefix matching).
function normalizeEmrJobRunId(value: string): string {
  return value.trim().replace(/^spark-/i, "").trim();
}

/**
 * The single MCP tool.
 *
 * Flow:
 *  1. Locate the job. If a virtualClusterId is supplied, describe it directly
 *     (fast path within one account/cluster). Otherwise search across the
 *     configured accounts via the bridge (active account first, then others).
 *     Local job history is matched first, then AWS — same as the desktop app.
 *  2. If COMPLETED, short-circuit: the job ran normally — no log digging.
 *  3. Otherwise fetch the job's logs — S3 preferred, CloudWatch fallback — by
 *     resolving the log destination exactly like the desktop Logs page does
 *     (`jobLogDestinations.ts`).
 *  4. Filter noise, extract the error-relevant evidence (tracebacks, deepest
 *     cause, heuristic candidates) and — so the caller never comes away
 *     empty-handed — also return the (sanitized) raw logs themselves for the
 *     calling AI to judge.
 */
export function buildAnalyzeJobFailureTool(client: BridgeClient) {
  return async (args: AnalyzeJobFailureArgs) => {
    const jobId = normalizeEmrJobRunId(args.jobId);

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
      // Cross-account search: local job history first, then AWS, active
      // account first — the same lookup order as the desktop Job History.
      const found: BridgeFindJobResult = await client.findJobById(jobId);
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
      describeDetails: describe,
      logType: args.logType,
      stream: args.stream,
    });

    // --- 4. Extract the error-relevant lines -------------------------------
    const filtered = filterLogNoise(evidence.logText);
    const analysis = extractErrorSections(filtered.text);
    const candidateCauses = analysis.candidateCauses.map((c) => ({
      ...c,
      evidence: sanitizeLogText(c.evidence),
    }));

    // The caller must always be able to analyze the failure even when the
    // heuristic extractor finds nothing: hand back the (noise-filtered,
    // sanitized) raw logs themselves.
    const RAW_LOG_TAIL_LINES = 800;
    const RAW_LOG_MAX_CHARS = 200_000;
    const relevantLines = filtered.text
      .split("\n")
      .filter((l) => l.trim() !== "" && !GENERIC_NOISE_INFO_RE.test(l));
    const rawLogTail = relevantLines.slice(-RAW_LOG_TAIL_LINES).join("\n");
    let rawLogs = sanitizeLogText(rawLogTail);
    if (rawLogs.length > RAW_LOG_MAX_CHARS) {
      rawLogs = `${rawLogs.slice(-RAW_LOG_MAX_CHARS)}\n[truncated]`;
    }

    const hasEvidence =
      analysis.errorTail.length > 0 || analysis.tracebacks.length > 0;

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
        hasEvidence,
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
        // The actual (noise-filtered, sanitized) log text: the last
        // RAW_LOG_TAIL_LINES lines. Always present so the caller can judge
        // even when the heuristic fields above are empty.
        rawLogs,
        truncated: relevantLines.length > RAW_LOG_TAIL_LINES || rawLogs.endsWith("[truncated]"),
      },
      meta: {
        totalLogLines: filtered.text.split("\n").length,
        noiseFilteredLines: filtered.hiddenCount,
        rawLogTailLines: Math.min(relevantLines.length, RAW_LOG_TAIL_LINES),
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
  hasEvidence: boolean,
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
  } else if (!hasEvidence) {
    parts.push(
      "No structured error evidence was extracted automatically; analyze evidence.rawLogs directly.",
    );
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
 * mirrors the desktop Logs page (`src/services/jobLogDestinations.ts`):
 *
 *  - S3       → configurationOverrides.monitoringConfiguration.s3MonitoringConfiguration.logUri
 *               → prefix `{logUri prefix}{virtualClusterId}/jobs/{jobId}/`
 *  - CloudWatch → cloudWatchMonitoringConfiguration (logGroupName +
 *               streamNamePrefix), falling back to the conventional
 *               `/aws/emr-containers/jobs/{jobId}` group with the job id as
 *               the stream prefix — the same fallback the Logs page uses. As
 *               a last resort, S3-only jobs also probe the conventional group
 *               in case the S3 archive is empty.
 */
async function gatherLogEvidence(
  client: BridgeClient,
  params: {
    accountId?: string;
    jobId: string;
    virtualClusterId?: string;
    describeDetails?: BridgeJobSummary["describeDetails"];
    logType?: string;
    stream?: string;
  },
): Promise<LogEvidence> {
  const { accountId, jobId, virtualClusterId, describeDetails, logType, stream } = params;
  const desiredStream = stream || "stderr";

  // Locate the job (local history first, then AWS) and learn its monitoring
  // configuration. `findJobById` re-resolves even when we already know the
  // account/cluster, because local job-history rows written by a StartJobRun
  // submission carry no describe details — their monitoring config only
  // exists in AWS. Errors here are non-fatal: we can still try the
  // conventional CloudWatch group.
  let described: BridgeJobSummary | undefined;
  try {
    described = virtualClusterId
      ? await client.describeJob({ accountId, jobId, virtualClusterId })
      : (await client.findJobById(jobId)).job;
  } catch {
    /* rely on the conventional CloudWatch fallback below */
  }

  const jobForDestinations = {
    id: jobId,
    virtualClusterId: virtualClusterId || "",
    describeDetails: described?.describeDetails || describeDetails,
  };

  // Mirror the Logs page: configured destinations win, otherwise fall back to
  // the conventional CloudWatch group naming.
  const resolved = resolveJobLogDestinations(jobForDestinations);
  const destinations =
    resolved.cloudWatch || resolved.s3
      ? resolved
      : { cloudWatch: defaultCloudWatchDestination({ id: jobId }) };

  // --- Try S3 first --------------------------------------------------------
  if (destinations.s3) {
    const s3Evidence = await fetchS3Evidence(client, accountId, destinations.s3, desiredStream);
    if (s3Evidence) return s3Evidence;
  }

  // --- Then CloudWatch -----------------------------------------------------
  if (destinations.cloudWatch) {
    const cwEvidence = await fetchCloudWatchEvidence(
      client,
      { accountId, jobId },
      destinations.cloudWatch,
      logType,
      stream,
    );
    if (cwEvidence) return cwEvidence;
  }

  // --- Last resort: the conventional CloudWatch group. Covers S3-only jobs
  // whose S3 archive is empty/missing (a job can have an s3MonitoringConfig
  // but zero objects there) yet still wrote to the default group.
  if (destinations.s3 && !destinations.cloudWatch) {
    const conventional = await fetchCloudWatchEvidence(
      client,
      { accountId, jobId },
      defaultCloudWatchDestination({ id: jobId }),
      logType,
      stream,
    );
    if (conventional) return conventional;
  }

  return { logText: "", source: "none" };
}

async function fetchS3Evidence(
  client: BridgeClient,
  accountId: string | undefined,
  s3Destination: S3LogDestination,
  desiredStream: string,
): Promise<LogEvidence | undefined> {
  try {
    const listing = await client.listS3Objects({
      accountId,
      bucket: s3Destination.bucket,
      prefix: s3Destination.prefix,
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
          bucket: s3Destination.bucket,
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
  return undefined;
}

async function fetchCloudWatchEvidence(
  client: BridgeClient,
  scope: { accountId?: string; jobId: string },
  cloudWatchDestination: CloudWatchLogDestination,
  logType?: string,
  stream?: string,
): Promise<LogEvidence | undefined> {
  try {
    const result = await client.getLogs({
      ...scope,
      logGroupName: cloudWatchDestination.logGroupName,
      streamNamePrefix: cloudWatchDestination.streamNamePrefix ?? "",
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
  return undefined;
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

// Spark-format lines that are routine informational chatter not worth shipping
// to the model as raw evidence. Applied on top of filterLogNoise's
// conservative keep rules when assembling evidence.rawLogs.
const GENERIC_NOISE_INFO_RE = /^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} INFO [^:]+:/;

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
