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
import {
  describeInvalidJobId,
  isLikelyEmrJobRunId,
  normalizeEmrJobRunId,
} from "./emrJobId.js";

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
 *  0. Validate the job id. A malformed id is returned to the caller as a
 *     correction request — never searched for.
 *  1. Locate the job. If a virtualClusterId is supplied, describe it directly
 *     (fast path within one account/cluster). Otherwise search across the
 *     configured accounts via the bridge (active account first, then others).
 *     Local job history is matched first, then AWS — same as the desktop app.
 *  2. If COMPLETED, short-circuit: the job ran normally — no log digging.
 *  3. Otherwise fetch the job's logs — S3 preferred, CloudWatch fallback — by
 *     resolving the log destination exactly like the desktop Logs page does
 *     (`jobLogDestinations.ts`). Controller (pod-level) logs are always
 *     collected alongside the Spark application logs.
 *  4. Filter noise, extract the error-relevant evidence (tracebacks, deepest
 *     cause, heuristic candidates) and — so the caller never comes away
 *     empty-handed — also return the (sanitized) raw logs themselves for the
 *     calling AI to judge.
 */
export function buildAnalyzeJobFailureTool(client: BridgeClient) {
  return async (args: AnalyzeJobFailureArgs) => {
    // --- 0. Reject malformed ids up front ----------------------------------
    // Searching every configured account for a truncated id wastes AWS calls
    // and reports a misleading "not found"; ask the caller to fix the input.
    if (!isLikelyEmrJobRunId(args.jobId)) {
      return invalidJobIdReport(args.jobId);
    }
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
    // Controller (pod-level) evidence is analyzed first and reported
    // separately: a pod that never started leaves nothing in the driver log,
    // so its errors must not be buried behind the Spark application logs.
    const controllerFiltered = filterLogNoise(evidence.controllerLogText);
    const controllerAnalysis = extractErrorSections(controllerFiltered.text);

    const filtered = filterLogNoise(evidence.logText);
    const analysis = extractErrorSections(filtered.text);
    const candidateCauses = analysis.candidateCauses.map((c) => ({
      ...c,
      evidence: sanitizeLogText(c.evidence),
    }));
    const controllerCandidateCauses = controllerAnalysis.candidateCauses.map((c) => ({
      ...c,
      evidence: sanitizeLogText(c.evidence),
    }));

    // The caller must always be able to analyze the failure even when the
    // heuristic extractor finds nothing: hand back the (noise-filtered,
    // sanitized) raw logs themselves.
    const RAW_LOG_TAIL_LINES = 800;
    const RAW_LOG_MAX_CHARS = 200_000;
    const CONTROLLER_TAIL_LINES = 200;
    const relevantLines = filtered.text
      .split("\n")
      .filter((l) => l.trim() !== "" && !GENERIC_NOISE_INFO_RE.test(l));
    const rawLogTail = relevantLines.slice(-RAW_LOG_TAIL_LINES).join("\n");
    let rawLogs = sanitizeLogText(rawLogTail);
    if (rawLogs.length > RAW_LOG_MAX_CHARS) {
      rawLogs = `${rawLogs.slice(-RAW_LOG_MAX_CHARS)}\n[truncated]`;
    }

    const controllerRelevantLines = controllerFiltered.text
      .split("\n")
      .filter((l) => l.trim() !== "" && !GENERIC_NOISE_INFO_RE.test(l));
    const controllerRawLogs = sanitizeLogText(
      controllerRelevantLines.slice(-CONTROLLER_TAIL_LINES).join("\n"),
    );

    const hasControllerEvidence =
      controllerAnalysis.errorTail.length > 0 ||
      controllerAnalysis.tracebacks.length > 0 ||
      controllerCandidateCauses.length > 0;
    const hasEvidence =
      analysis.errorTail.length > 0 || analysis.tracebacks.length > 0 || hasControllerEvidence;

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
        controllerCandidateCauses,
        evidence.source,
        hasEvidence,
      ),
      // Pod-level evidence, reported ahead of the application logs: check this
      // first — an image pull failure, OOMKill, or rejected service account
      // never reaches the Spark driver log.
      controllerEvidence: {
        logSource: evidence.controllerSource,
        errorTail: controllerAnalysis.errorTail.map((l) => sanitizeLogText(l)),
        tracebacks: controllerAnalysis.tracebacks.map((t) => sanitizeLogText(t)),
        deepestCausedBy: controllerAnalysis.deepestCausedBy
          ? sanitizeLogText(controllerAnalysis.deepestCausedBy)
          : null,
        candidateCauses: controllerCandidateCauses,
        rawLogs: controllerRawLogs,
      },
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
        controllerLogLines: controllerRelevantLines.length,
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

/**
 * A malformed job id is a caller mistake, not a lookup failure. Return the
 * problem plus what a valid id looks like so the caller can re-prompt the user,
 * and make it explicit that no search was attempted.
 */
function invalidJobIdReport(rawJobId: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: false,
            error: "invalidJobId",
            providedJobId: rawJobId,
            summary: describeInvalidJobId(rawJobId),
            expectedFormat:
              'A lowercase alphanumeric EMR on EKS job run id of 16-64 characters (e.g. "0000000381t77o3g8f5"), optionally prefixed with "spark-". Classic "job-…" ids are also accepted.',
            nextStep:
              "Ask the user for the complete job id and call analyze_job_failure again. Do not guess, truncate, or search for alternatives.",
          },
          null,
          2,
        ),
      },
    ],
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
  controllerCandidateCauses: Array<{ cause: string; confidence: string }>,
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
  // Pod-level causes lead: they explain failures that never reach Spark.
  if (controllerCandidateCauses.length > 0) {
    parts.push(
      `Controller (pod-level) causes: ${controllerCandidateCauses
        .map((c) => `${c.cause} (${c.confidence})`)
        .join("; ")}`,
    );
  }
  if (candidateCauses.length > 0) {
    parts.push(
      `Application (Spark) causes: ${candidateCauses
        .map((c) => `${c.cause} (${c.confidence})`)
        .join("; ")}`,
    );
  }
  if (source === "none") {
    parts.push("No application log source was found (neither S3 nor CloudWatch).");
  } else if (!hasEvidence) {
    parts.push(
      "No structured error evidence was extracted automatically; analyze controllerEvidence.rawLogs and evidence.rawLogs directly.",
    );
  }
  return parts.length > 0
    ? parts.join("\n")
    : `Job is in state ${state} with no additional detail available.`;
}

interface LogEvidence {
  logText: string;
  source: "s3" | "cloudwatch" | "none";
  /** Pod-level (control-logs / controller container) text, gathered separately. */
  controllerLogText: string;
  controllerSource: "s3" | "cloudwatch" | "none";
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
 *
 * Controller logs (`control-logs/<pod>/<stream>` in S3, the non-driver /
 * non-executor streams in CloudWatch) are collected in addition to the Spark
 * application logs: a pod that never started — image pull failure, OOMKilled,
 * a rejected service account — leaves nothing in the driver log, so the only
 * error text lives at the pod level.
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

  // --- Collect both tiers from each source ---------------------------------
  // S3 is listed once and CloudWatch fetched once; the results are split into
  // controller (pod-level) and application (driver/executor) text rather than
  // querying AWS twice for the same data.
  let controller: SourcedLogText | undefined;
  let application: SourcedLogText | undefined;

  if (destinations.s3) {
    const fromS3 = await fetchS3Evidence(client, accountId, destinations.s3, {
      desiredStream,
      applicationType: (logType || "driver").toLowerCase(),
    });
    controller = fromS3.controller;
    application = fromS3.application;
  }

  // CloudWatch fills whichever tier S3 did not provide.
  if (!controller || !application) {
    const cloudWatchDestination =
      destinations.cloudWatch ??
      // S3-only jobs whose archive is empty/missing still often wrote to the
      // conventional group, so probe it as a last resort.
      (destinations.s3 ? defaultCloudWatchDestination({ id: jobId }) : undefined);

    if (cloudWatchDestination) {
      const fromCloudWatch = await fetchCloudWatchEvidence(
        client,
        { accountId, jobId },
        cloudWatchDestination,
        logType,
        stream,
      );
      controller = controller ?? fromCloudWatch.controller;
      application = application ?? fromCloudWatch.application;
    }
  }

  return {
    logText: application?.logText ?? "",
    source: application?.source ?? "none",
    controllerLogText: controller?.logText ?? "",
    controllerSource: controller?.source ?? "none",
  };
}

type SourcedLogText = { logText: string; source: "s3" | "cloudwatch" };

/** Controller (pod-level) and application (driver/executor) text from one source. */
interface SplitEvidence {
  controller?: SourcedLogText;
  application?: SourcedLogText;
}

interface Destinations {
  s3?: S3LogDestination;
  cloudWatch?: CloudWatchLogDestination;
}

/**
 * List the job's S3 log objects once, then read the controller and application
 * tiers separately. The bridge classifies each object (controller / driver /
 * executor) with the same path rules as the desktop app; the key is checked as
 * a fallback for objects it could not classify.
 */
async function fetchS3Evidence(
  client: BridgeClient,
  accountId: string | undefined,
  s3Destination: S3LogDestination,
  options: { desiredStream: string; applicationType: string },
): Promise<SplitEvidence> {
  try {
    const listing = await client.listS3Objects({
      accountId,
      bucket: s3Destination.bucket,
      prefix: s3Destination.prefix,
    });

    const isController = (o: { type?: string; s3Key: string }) =>
      o.type === "controller" || o.s3Key.includes("/control-logs/");

    const controllerObjects = listing.objects.filter(isController);
    const applicationObjects =
      options.applicationType === "controller"
        ? controllerObjects
        : listing.objects.filter((o) => !isController(o));

    const [controllerText, applicationText] = await Promise.all([
      // Controller logs are small and there is only ever one stream worth
      // reading, so no stream filter is applied here.
      readS3Objects(client, accountId, s3Destination.bucket, controllerObjects, undefined),
      readS3Objects(
        client,
        accountId,
        s3Destination.bucket,
        applicationObjects,
        options.desiredStream,
      ),
    ]);

    return {
      controller: controllerText ? { logText: controllerText, source: "s3" } : undefined,
      application: applicationText ? { logText: applicationText, source: "s3" } : undefined,
    };
  } catch {
    /* fall through to CloudWatch */
    return {};
  }
}

const MAX_S3_OBJECTS_PER_TIER = 5;

async function readS3Objects(
  client: BridgeClient,
  accountId: string | undefined,
  bucket: string,
  objects: Array<{ s3Key: string }>,
  desiredStream: string | undefined,
): Promise<string> {
  let candidates = objects;
  if (desiredStream) {
    const matching = candidates.filter((o) =>
      o.s3Key.toLowerCase().includes(desiredStream.toLowerCase()),
    );
    if (matching.length > 0) candidates = matching;
  }

  const messages: string[] = [];
  for (const obj of candidates.slice(0, MAX_S3_OBJECTS_PER_TIER)) {
    try {
      const content = await client.getS3Object({ accountId, bucket, key: obj.s3Key });
      messages.push(...content.content.split("\n").filter(Boolean));
    } catch {
      /* skip unreadable object */
    }
  }
  return messages.join("\n");
}

/**
 * Fetch the job's CloudWatch entries once, then split them by stream name:
 * driver / executor streams are the application tier, everything else (the
 * control pod) is the controller tier.
 */
async function fetchCloudWatchEvidence(
  client: BridgeClient,
  scope: { accountId?: string; jobId: string },
  cloudWatchDestination: CloudWatchLogDestination,
  logType?: string,
  stream?: string,
): Promise<SplitEvidence> {
  try {
    const result = await client.getLogs({
      ...scope,
      logGroupName: cloudWatchDestination.logGroupName,
      streamNamePrefix: cloudWatchDestination.streamNamePrefix ?? "",
      limit: 5000,
    });

    const isDriver = (name: string) => name.toLowerCase().includes("driver");
    const isExecutor = (name: string) => name.toLowerCase().includes("exec");
    const want = (logType || "driver").toLowerCase();

    const controllerEntries = result.entries.filter(
      (e) => !isDriver(e.streamName) && !isExecutor(e.streamName),
    );

    let applicationEntries = result.entries;
    if (want === "driver") {
      applicationEntries = result.entries.filter((e) => isDriver(e.streamName));
    } else if (want === "executor") {
      applicationEntries = result.entries.filter((e) => isExecutor(e.streamName));
    } else if (want === "controller") {
      applicationEntries = controllerEntries;
    }
    if (stream) {
      const streamFiltered = applicationEntries.filter((e) =>
        e.streamName.toLowerCase().includes(stream.toLowerCase()),
      );
      if (streamFiltered.length > 0) applicationEntries = streamFiltered;
    }

    const join = (entries: typeof result.entries) => entries.map((e) => e.message).join("\n");
    return {
      controller:
        controllerEntries.length > 0
          ? { logText: join(controllerEntries), source: "cloudwatch" }
          : undefined,
      application:
        applicationEntries.length > 0
          ? { logText: join(applicationEntries), source: "cloudwatch" }
          : undefined,
    };
  } catch {
    /* leave both tiers empty */
    return {};
  }
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
