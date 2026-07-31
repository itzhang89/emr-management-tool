const SPARK_LINE_RE =
  /^(\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERROR|DEBUG|TRACE) ([^:]+): (.*)$/;

/** Exact logger base names (after stripping `$...`) that are always noise at INFO. */
const NOISE_LOGGER_EXACT = new Set([
  "TaskSetManager",
  "DAGScheduler",
  "BlockManagerInfo",
  "TaskSchedulerImpl",
  "MemoryStore",
  "AuditContextUtil",
  "EMRFSToS3AConfigMapping",
  "CodeGenerator",
  "AppInfoParser",
  "Metrics",
  "SecurityManager",
  "ResourceUtils",
  "JettyUtils",
  "SparkEnv",
  "DiskBlockManager",
  "CoarseGrainedExecutorBackend",
  "ShuffleBlockFetcherIterator",
  "TorrentBroadcast",
  "FileScanRDD",
  "MapPartitionsRDD",
  "TransportClientFactory",
  "HiveConf",
  "EMRParamSideChannel",
  "SharedState",
  "SubResultCacheManager",
  "ContextCleaner",
  "AsyncFileDownloader",
  "SignalUtils",
  "PathOutputCommitterFactory",
  "CommitOperations",
  "SubscriptionState",
  "NativeCodeLoader",
  "ShutdownHookManager",
  "CodecPool",
  "SchedulerExtensionServices"
]);

const NOISE_LOGGER_PREFIXES = [
  "MapOutputTracker",
  "ResourceProfile",
  "BlockManager",
  "AbstractS3ACommitter",
  "YarnScheduler"
] as const;

const SPARK_CONTEXT_KEEP_SUBSTRINGS = [
  "Running Spark version",
  "Submitted application",
  "Successfully stopped",
  "SparkContext cleaned",
  "Invoking stop"
] as const;

function loggerBase(logger: string) {
  return logger.split("$")[0] ?? logger;
}

function isNoiseLogger(base: string) {
  if (NOISE_LOGGER_EXACT.has(base)) return true;
  return NOISE_LOGGER_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function shouldHideSparkLine(level: string, logger: string, message: string) {
  // Spec: blacklist and message rules apply to INFO only; WARN/ERROR/DEBUG/TRACE stay.
  if (level !== "INFO") return false;

  const base = loggerBase(logger);

  if (base === "Executor") {
    return (
      message.startsWith("Running task") ||
      message.startsWith("Finished task") ||
      message.includes("block locks were not released")
    );
  }

  if (base === "SparkContext") {
    return !SPARK_CONTEXT_KEEP_SUBSTRINGS.some((keep) => message.includes(keep));
  }

  if (base === "Utils") {
    return !message.includes("Successfully started service");
  }

  if (base === "SQLExecution") {
    return message.includes("SparkListenerSQLExecutionObfuscatedInfo");
  }

  return isNoiseLogger(base);
}

export function filterLogNoise(text: string): { text: string; hiddenCount: number } {
  if (!text) return { text: "", hiddenCount: 0 };

  const lines = text.split("\n");
  const kept: string[] = [];
  let hiddenCount = 0;

  for (const line of lines) {
    if (line.startsWith("SLF4J:")) {
      hiddenCount += 1;
      continue;
    }

    const match = SPARK_LINE_RE.exec(line);
    if (!match) {
      kept.push(line);
      continue;
    }

    const level = match[2]!;
    const logger = match[3]!;
    const message = match[4] ?? "";

    if (shouldHideSparkLine(level, logger, message)) {
      hiddenCount += 1;
      continue;
    }

    kept.push(line);
  }

  return { text: kept.join("\n"), hiddenCount };
}
