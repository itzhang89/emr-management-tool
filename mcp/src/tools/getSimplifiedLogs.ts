import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { sanitizeLogText } from "../sanitize/index.js";

export const GetSimplifiedLogsArgs = z.object({
  jobId: z.string().min(1, "jobId is required"),
  virtualClusterId: z.string().optional(),
  accountId: z.string().optional(),
  logType: z.enum(["driver", "executor", "controller"]).optional().default("driver"),
  stream: z.string().optional().default("stderr"),
  maxChars: z.number().int().positive().optional().default(512_000),
  includeNoise: z.boolean().optional().default(false),
});

export type GetSimplifiedLogsArgs = z.infer<typeof GetSimplifiedLogsArgs>;

export interface SimplifiedLogsResult {
  text: string;
  hiddenCount: number;
  truncated: boolean;
  totalCharacters: number;
  source: "s3" | "cloudwatch" | "none";
  entries: number;
}

type S3UriMatch = { bucket: string; prefix: string } | null;

function parseS3Uri(uri: string): S3UriMatch {
  const m = uri.match(/^s3:\/\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return { bucket: m[1]!, prefix: m[2] || "" };
}

export function buildGetSimplifiedLogsTool(client: BridgeClient) {
  return async (args: GetSimplifiedLogsArgs): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    const { jobId, maxChars, includeNoise } = args;

    let logText = "";
    let source: "s3" | "cloudwatch" | "none" = "none";
    let entryCount = 0;

    // Step 1: Describe job to find S3 log URI
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

    // Resolve the virtual cluster id from the caller or the describe result.
    const virtualClusterId = args.virtualClusterId || jobSummary?.virtualClusterId || "";

    // Step 2: Try S3 first
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

          if (s3Objects.objects.length > 0) {
            const targetStream = args.stream || "stderr";
            const matching = s3Objects.objects.filter((o) =>
              o.s3Key.toLowerCase().includes(targetStream.toLowerCase()),
            );
            const relevant = (matching.length > 0 ? matching : s3Objects.objects).slice(0, 5);

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
                /* skip unreadable */
              }
            }

            if (allMessages.length > 0) {
              logText = allMessages.join("\n");
              entryCount = allMessages.length;
              source = "s3";
            }
          }
        }
      } catch {
        /* fall through to CloudWatch */
      }
    }

    // Step 3: Fall back to CloudWatch
    if (!logText) {
      try {
        const logGroupName = `/aws/emr-containers/jobs/${jobId}`;
        const streamNamePrefix = `${virtualClusterId}/jobs/${jobId}/containers`;

        const result = await client.getLogs({
          accountId: args.accountId,
          jobId,
          logGroupName,
          streamNamePrefix,
          limit: 5000,
        });

        let entries = result.entries;
        if (args.logType === "driver") {
          entries = entries.filter((e) => e.streamName.toLowerCase().includes("driver"));
        } else if (args.logType === "executor") {
          entries = entries.filter((e) => e.streamName.toLowerCase().includes("exec"));
        } else if (args.logType === "controller") {
          entries = entries.filter(
            (e) => !e.streamName.toLowerCase().includes("driver") && !e.streamName.toLowerCase().includes("exec"),
          );
        }

        if (args.stream) {
          const streamFiltered = entries.filter((e) =>
            e.streamName.toLowerCase().includes(args.stream!.toLowerCase()),
          );
          if (streamFiltered.length > 0) entries = streamFiltered;
        }

        logText = entries.map((e) => e.message).join("\n");
        entryCount = entries.length;
        source = "cloudwatch";
      } catch {
        /* leave logText empty */
      }
    }

    // Step 4: Apply noise filter
    let hiddenCount = 0;
    if (!includeNoise && logText) {
      const filtered = filterLogNoise(logText);
      logText = filtered.text;
      hiddenCount = filtered.hiddenCount;
    }

    // Step 5: Sanitize
    logText = sanitizeLogText(logText);

    // Step 6: Truncate
    const totalCharacters = logText.length;
    let truncated = false;
    if (logText.length > maxChars) {
      logText = logText.slice(0, maxChars);
      truncated = true;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              text: logText,
              hiddenCount,
              truncated,
              totalCharacters,
              source,
              entries: entryCount,
            } satisfies SimplifiedLogsResult,
            null,
            2,
          ),
        },
      ],
    };
  };
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

    if (level === "INFO" && isNoiseLogger(logger)) {
      if (logger === "Executor" && (message.startsWith("Running task") || message.startsWith("Finished task"))) {
        hiddenCount += 1;
        continue;
      }
      if (logger === "SparkContext" && !["Running Spark version", "Submitted application"].some((k) => message.includes(k))) {
        hiddenCount += 1;
        continue;
      }
      hiddenCount += 1;
      continue;
    }

    kept.push(line);
  }

  return { text: kept.join("\n"), hiddenCount };
}